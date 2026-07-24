import {
  type Classification,
  type ClassificationOrQuarantine,
  type BenefitType,
  type Setting,
  type NetworkStatus,
  QUARANTINE,
  toClassification,
  INTERMEDIATE_ANALOG,
  housingSetting,
} from './classifications.js';
import { settingFromCodes } from './code-maps.js';
import { determineBenefitType, type MhsudDetermination } from './mhsud-identification.js';

export interface ClaimInput {
  claimId?: string;
  placeOfService?: string;
  revenueCode?: string;
  procedureCode?: string;
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  providerTaxonomy?: string;
  networkStatus?: string; // raw value: 'IN'/'OUT'/'in_network'/etc.
  claimType?: string;
}

export interface ClaimClassification {
  claimId: string | undefined;
  benefitType: BenefitType;
  setting: Setting;
  network: NetworkStatus;
  classification: ClassificationOrQuarantine;
  quarantined: boolean;
  quarantineReason?: string;
  isIntermediate: boolean;
  intermediateAnalog?: { housingSetting: string; msAnalog: string };
  mhsud: MhsudDetermination;
  basis: string[];
}

const IN_NETWORK_TOKENS = new Set(['in', 'inn', 'in_network', 'in-network', 'par', 'participating', 'yes', 'y', 'i', 'network']);
const OUT_NETWORK_TOKENS = new Set(['out', 'oon', 'out_of_network', 'out-of-network', 'nonpar', 'non-par', 'nonparticipating', 'no', 'n', 'o']);

export function normalizeNetwork(raw: string | undefined): NetworkStatus {
  if (!raw) return 'not_applicable';
  const v = raw.trim().toLowerCase();
  if (IN_NETWORK_TOKENS.has(v)) return 'in_network';
  if (OUT_NETWORK_TOKENS.has(v)) return 'out_of_network';
  return 'not_applicable';
}

function isPharmacy(input: ClaimInput): boolean {
  const t = input.claimType?.trim().toLowerCase() ?? '';
  return t === 'pharmacy' || t === 'rx' || t === 'ndc';
}

export function classifyClaim(input: ClaimInput): ClaimClassification {
  const basis: string[] = [];

  const mhsud = determineBenefitType({
    diagnosis: { primary: input.primaryDiagnosis, secondary: input.secondaryDiagnoses },
    procedureCode: input.procedureCode,
    providerTaxonomy: input.providerTaxonomy,
  });
  basis.push(`benefit type: ${mhsud.benefitType} (${mhsud.basis})`);

  let setting: Setting;
  if (isPharmacy(input)) {
    setting = 'prescription';
    basis.push('setting: prescription (claim type indicates pharmacy)');
  } else {
    const s = settingFromCodes({
      placeOfService: input.placeOfService,
      revenueCode: input.revenueCode,
      procedureCode: input.procedureCode,
    });
    setting = s.setting;
    basis.push(`setting: ${setting} (${s.basis})`);
  }

  const network = normalizeNetwork(input.networkStatus);
  basis.push(`network: ${network}`);

  const isIntermediate =
    setting === 'intermediate_residential' ||
    setting === 'intermediate_php' ||
    setting === 'intermediate_iop';

  if (isIntermediate) {
    const analog = INTERMEDIATE_ANALOG[setting as keyof typeof INTERMEDIATE_ANALOG];
    basis.push(
      `intermediate care: housed in ${analog.housingSetting} classification per DOL analog (${analog.msAnalog})`,
    );
  }

  const classification = toClassification(setting, network);
  const quarantined = classification === QUARANTINE;

  // A benefit type we cannot determine is NOT quarantined by itself (an M/S vs
  // MH/SUD ambiguity can still be examined), but an indeterminate SETTING is.
  let quarantineReason: string | undefined;
  if (quarantined) {
    quarantineReason = `Unmappable setting (${setting}). ${
      basis.find((b) => b.startsWith('setting:')) ?? ''
    } — routed to manual review, not silently bucketed.`;
  }

  return {
    claimId: input.claimId,
    benefitType: mhsud.benefitType,
    setting,
    network,
    classification,
    quarantined,
    ...(quarantineReason ? { quarantineReason } : {}),
    isIntermediate,
    ...(isIntermediate
      ? { intermediateAnalog: INTERMEDIATE_ANALOG[setting as keyof typeof INTERMEDIATE_ANALOG] }
      : {}),
    mhsud,
    basis,
  };
}

/**
 * Intermediate-care misclassification detector (as-written).
 *
 * The DOL position: residential MH/SUD treatment must be housed in the same
 * classification as its M/S analog (SNF / inpatient rehab = inpatient). If a
 * plan's OWN stated benefit schedule classifies residential MH/SUD as
 * OUTPATIENT while classifying SNF / inpatient rehab as INPATIENT, that
 * asymmetry is itself a finding.
 */
export interface PlanStatedSettingMap {
  residentialMhsud?: 'inpatient' | 'outpatient';
  skilledNursingOrRehab?: 'inpatient' | 'outpatient';
  phpMhsud?: 'inpatient' | 'outpatient';
}

export interface IntermediateMisclassification {
  detected: boolean;
  detail: string;
}

export function detectIntermediateMisclassification(
  plan: PlanStatedSettingMap,
): IntermediateMisclassification {
  if (
    plan.residentialMhsud === 'outpatient' &&
    plan.skilledNursingOrRehab === 'inpatient'
  ) {
    return {
      detected: true,
      detail:
        'Plan classifies residential MH/SUD treatment as OUTPATIENT while classifying its M/S analog ' +
        '(skilled nursing / inpatient rehabilitation) as INPATIENT. Under the DOL intermediate-care ' +
        'analog position, residential MH/SUD must be housed in the inpatient classification. This ' +
        'asymmetry understates the stringency applied to MH/SUD and is a finding requiring review.',
    };
  }
  return { detected: false, detail: 'No residential-vs-SNF classification asymmetry detected.' };
}

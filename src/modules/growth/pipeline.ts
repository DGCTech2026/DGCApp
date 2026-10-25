import type { GrowthStageKey, RequirementType } from '@prisma/client';

export type PipelineRequirement = { key: string; label: string; type: RequirementType };

export type PipelineStage = {
  key: GrowthStageKey;
  order: number;
  name: string;
  requirements: PipelineRequirement[];
};

// The ten rooms the app shows, in order. Every room except Pastorate has one task that
// opens the next door. An empty earlier room would stop the whole line.
export const GROWTH_STAGES: PipelineStage[] = [
  {
    key: 'FIRST_TIMER',
    order: 1,
    name: 'First Timer',
    requirements: [
      { key: 'CREATE_ACCOUNT', label: 'Create your account', type: 'AUTO' },
      { key: 'JOIN_BRANCH', label: 'Join a branch', type: 'AUTO' },
      { key: 'SERVICE_PHOTO_UPLOADED', label: 'Upload a photo of a service you attended', type: 'URL_UPLOAD' },
    ],
  },
  {
    key: 'NEW_MEMBER',
    order: 2,
    name: 'New Member',
    requirements: [{ key: 'JOIN_CLUSTER', label: 'Join a cluster', type: 'AUTO' }],
  },
  {
    key: 'FOUNDATIONS_GRADUATE',
    order: 3,
    name: 'Foundation School Graduate',
    requirements: [
      { key: 'FOUNDATIONS_CERT_VERIFIED', label: 'Upload your Foundation School certificate', type: 'CERTIFICATE' },
    ],
  },
  {
    key: 'WORKER',
    order: 4,
    name: 'Worker',
    requirements: [
      { key: 'UNIT_LEADER_LETTER_UPLOADED', label: 'Upload a letter from your unit leader', type: 'URL_UPLOAD' },
    ],
  },
  {
    key: 'EMERGING_LEADER',
    order: 5,
    name: 'Emerging Leader',
    requirements: [
      { key: 'WORKER_SOM_CERT_VERIFIED', label: 'Upload your School of Ministry certificate', type: 'CERTIFICATE' },
    ],
  },
  {
    key: 'CELL_LEADER',
    order: 6,
    name: 'Cell Leader',
    requirements: [
      { key: 'CELL_LEADERSHIP_CONFIRMED', label: 'A leader confirms you are leading a cell', type: 'ADMIN_VERIFY' },
    ],
  },
  {
    key: 'ADVANCED_SOM_GRADUATE',
    order: 7,
    name: 'Advanced SOM Graduate',
    requirements: [
      { key: 'ADVANCED_SOM_CERT_VERIFIED', label: 'Upload your Advanced SOM certificate', type: 'CERTIFICATE' },
    ],
  },
  {
    key: 'MINISTRY_LEADER',
    order: 8,
    name: 'Ministry Leader',
    requirements: [
      { key: 'MINISTRY_APPOINTMENT_CONFIRMED', label: 'A leader confirms you lead a ministry', type: 'ADMIN_VERIFY' },
    ],
  },
  {
    key: 'PASTORATE_CANDIDATE',
    order: 9,
    name: 'Pastorate Candidate',
    requirements: [{ key: 'SPIRITUAL_OVERSIGHT_APPROVAL', label: 'Spiritual oversight approval', type: 'ADMIN_VERIFY' }],
  },
  { key: 'PASTORATE', order: 10, name: 'Pastorate', requirements: [] },
];

// Medal for the room just finished. Keys differ where the medal is not the room
// (Emerging Leader earns SOM Graduate). Rooms omitted here earn no medal.
// Prayer Chain, Mentor, and Evangelist stay in the badge catalogue unwired.
export const STAGE_BADGE_KEY: Partial<Record<GrowthStageKey, string>> = {
  FOUNDATIONS_GRADUATE: 'FOUNDATIONS_GRADUATE',
  EMERGING_LEADER: 'SOM_GRADUATE',
  CELL_LEADER: 'CELL_LEADER',
  ADVANCED_SOM_GRADUATE: 'ADVANCED_SOM_GRADUATE',
  MINISTRY_LEADER: 'MINISTRY_LEADER',
  PASTORATE: 'PASTORATE',
};

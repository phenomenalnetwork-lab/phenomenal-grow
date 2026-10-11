export type OrganisationId = string;

export const MembershipRoles = ["OWNER", "AGENT"] as const;
export type MembershipRole = (typeof MembershipRoles)[number];

export const ContactStatuses = ["ACTIVE", "INACTIVE", "ARCHIVED", "DNC"] as const;
export type ContactStatus = (typeof ContactStatuses)[number];

export const Outcomes = ["ONGOING", "CONVERTED", "NOT_CONVERTED"] as const;
export type Outcome = (typeof Outcomes)[number];

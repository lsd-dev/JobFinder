// Shared with the scanner so the two can never drift apart.
export type { Company, JobStage, JobStatus, SourceConfig, StoredJob, Tier } from "../../scanner/src/types.js";
export type { CompanyHealth } from "../../scanner/src/store/types.js";
export type { Profile, Settings } from "../../scanner/src/config/profile.js";
export { DEFAULT_PROFILE, DEFAULT_SETTINGS, isValidTimeZone } from "../../scanner/src/config/profile.js";

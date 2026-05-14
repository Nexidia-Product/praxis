// Data access layer — the single boundary between the application and storage.
//
// Per the design document (Section 3.3), every page, component, and API route
// accesses data ONLY through this module. This is what keeps the storage
// choice swappable: the initial implementation reads and writes JSON files
// under /data, but the function signatures exported here will stay identical
// when a database is introduced later.
//
// Importers should always go through this index — never reach into the
// individual files. That is what makes a single coordinated swap to a real
// database possible later.
//
//   import { ProjectRepository, type Project } from "@/lib/db";

// Shared types (entities, enums, embedded shapes).
export * from "./types";

// Repositories (one per JSON file under /data).
export { ProjectRepository } from "./projects";
export type { CreateProjectInput, UpdateProjectInput } from "./projects";

export { TaskRepository } from "./tasks";
export type { CreateTaskInput, UpdateTaskInput } from "./tasks";

export { IdeaRepository } from "./ideas";
export type { CreateIdeaInput, UpdateIdeaInput } from "./ideas";

export { UserRepository } from "./users";
export type { CreateUserInput, UpdateUserInput } from "./users";

export { NotificationRepository } from "./notifications";
export type {
  CreateNotificationInput,
  UpdateNotificationInput,
} from "./notifications";

export { DecisionRepository } from "./decisions";
export type { CreateDecisionInput } from "./decisions";

export { TemplateRepository } from "./templates";
export type { CreateTemplateInput, UpdateTemplateInput } from "./templates";

export { AuditLogRepository } from "./audit-log";
export type { CreateAuditEntryInput, RecentAuditQuery } from "./audit-log";

export { SettingsRepository } from "./settings";

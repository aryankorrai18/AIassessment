import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type {
  AdminUserDoc, ApiUsageLogDoc, AuditLogDoc, CandidateDoc, CompletedInterviewDoc, DemandClusterDoc,
  GeminiKeySettingDoc, InterviewDoc, JdMasterDoc, MasterExportDoc, QuestionBankDoc, SessionDoc, ViolationDoc,
} from "../types/domain";

const col = <T>(name: string) => db.collection(name) as CollectionReference<T>;

export const adminUsersCol = () => col<AdminUserDoc>("adminUsers");
export const jdMasterCol = () => col<JdMasterDoc>("jdMaster");
export const candidatesCol = () => col<CandidateDoc>("candidates");
export const interviewsCol = () => col<InterviewDoc>("interviews");
export const questionBankCol = () => col<QuestionBankDoc>("questionBank");
export const demandClustersCol = () => col<DemandClusterDoc>("demandClusters");
export const completedInterviewsCol = () => col<CompletedInterviewDoc>("completedInterviews");
export const apiUsageLogCol = () => col<ApiUsageLogDoc>("apiUsageLog");
export const masterExportsCol = () => col<MasterExportDoc>("masterExports");
export const appSettingsCol = () => col<GeminiKeySettingDoc>("appSettings");
export const auditLogCol = () => col<AuditLogDoc>("auditLog");

export const sessionDoc = (interviewId: string) =>
  interviewsCol().doc(interviewId).collection("session").doc("current") as DocumentReference<SessionDoc>;
export const violationsCol = (interviewId: string) =>
  interviewsCol().doc(interviewId).collection("violations") as CollectionReference<ViolationDoc>;

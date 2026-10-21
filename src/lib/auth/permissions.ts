export type ActorScope = { userId: string; organizationId: string; role: "admin" | "manager" | "reviewer" };
export function canWrite(actor: Pick<ActorScope, "role">) { return actor.role === "admin" || actor.role === "manager"; }
export function assertWriter(actor: ActorScope) {
  if (!canWrite(actor)) throw new Error("이 계정은 조회만 가능합니다. 관리자에게 편집 권한을 요청하세요.");
}

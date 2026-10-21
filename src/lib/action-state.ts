import { z } from "zod";
export type ActionState = { error: string };
export const initialState: ActionState = { error: "" };
export function actionError(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { error: error.issues.map(i => i.message).join(" · ") };
  // Do not serialize database errors, SQL parameters, or connection details.
  return { error: "저장하지 못했습니다. 입력값과 접근 권한을 확인한 뒤 다시 시도해 주세요." };
}

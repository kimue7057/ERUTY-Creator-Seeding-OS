export class AssetError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const denied = () => new AssetError(404, "not_found", "자료를 찾을 수 없거나 접근 권한이 없습니다.");

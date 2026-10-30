"use client";
import { PLATFORMS } from "@/lib/validation/campaigns";
import type { Candidate } from "@/lib/evaluation/presentation";

export function ChannelFilter({ candidates, value, onChange }: { candidates: Pick<Candidate, "platform">[]; value: string; onChange: (value: string) => void }) {
  return <div className="channel-filters" role="group" aria-label="SNS 채널 필터">
    {[{ value: "", label: "전체 채널" }, ...PLATFORMS].map(channel => <button type="button" key={channel.value} data-platform={channel.value || "all"} aria-pressed={value === channel.value} onClick={() => onChange(channel.value)}>
      <span className="channel-dot" aria-hidden="true" /><span>{channel.label}</span><strong>{candidates.filter(c => !channel.value || c.platform === channel.value).length}</strong>
    </button>)}
  </div>;
}

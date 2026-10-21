"use client";
import { useEffect, useRef } from "react";
export function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  if (!message) return null;
  return <div ref={ref} role="alert" tabIndex={-1} className="form-error">{message}</div>;
}

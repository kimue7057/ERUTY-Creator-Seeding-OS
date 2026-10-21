"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
// Keep controlled fields disabled until React can preserve their input events.
export function useHydrated() { return useSyncExternalStore(subscribe, () => true, () => false); }

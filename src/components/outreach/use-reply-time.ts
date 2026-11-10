"use client";
import { useEffect,useState } from "react";
export function useReplyTime(){
  const [now,setNow]=useState<number|null>(null);
  useEffect(()=>{const tick=()=>setNow(Date.now());const initial=setTimeout(tick,0),timer=setInterval(tick,1000);return()=>{clearTimeout(initial);clearInterval(timer);};},[]);
  return now;
}

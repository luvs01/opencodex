import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { LanguageProvider } from "../src/i18n/provider";
import { en } from "../src/i18n/en";
import ClaudeCode from "../src/pages/ClaudeCode";
import type { Root } from "react-dom/client";

const globals = ["document", "window", "navigator", "localStorage", "sessionStorage", "IS_REACT_ACT_ENVIRONMENT", "fetch"] as const;
let saved: Record<string, PropertyDescriptor | undefined>;
let win: Window;
let root: Root | undefined;
beforeEach(() => {
  saved = Object.fromEntries(globals.map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  win = new Window({ url: "http://localhost/" });
  Object.defineProperty(win.navigator,"language",{configurable:true,value:"en-US"});
  for (const name of globals.slice(0,5)) Object.defineProperty(globalThis,name,{configurable:true,value:win[name as keyof Window]});
  Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,writable:true,value:true});
});
afterEach(async () => {
  if(root) await act(async()=>root!.unmount()); root=undefined;
  win.close();
  for(const key of globals) { const d=saved[key]; if(d) Object.defineProperty(globalThis,key,d); else Reflect.deleteProperty(globalThis,key); }
});
for(const warned of [true,false]) {
  test(`successful PUT ${warned ? "preserves" : "does not invent"} a retained warning across GET refresh`,async()=>{
    let changed=false;
    const state=()=>({enabled:true,cliFirstParty:!changed,cliFirstPartyApplied:!changed,desktopFirstParty:changed,
      interceptRunning:false,interceptEligible:true,sharedProxy:"stopped",authMode:"proxy",autoConnectSupported:false,
      systemEnv:false,fastMode:null,maxContextTokens:null,autoContext:true,autoCompactWindow:null,injectAgents:true,
      smallFastModel:"",effectiveModelEnv:{},available:[],aliases:[],port:10100});
    Object.defineProperty(globalThis,"fetch",{configurable:true,value:async (_input:unknown,init?:RequestInit)=>{
      if(init?.method==="PUT") {changed=true;return Response.json({ok:true,cliFirstParty:false,warnings:warned?["shared_proxy_retained"]:[]});}
      return Response.json(state());
    }});
    const host=document.createElement("div");document.body.append(host);
    const {createRoot}=await import("react-dom/client");
    await act(async()=>{root=createRoot(host);root.render(<LanguageProvider><ClaudeCode apiBase="http://127.0.0.1:19100" /></LanguageProvider>);await Bun.sleep(25);});
    const toggle=host.querySelector<HTMLButtonElement>(`button.switch[aria-label="${en["claude.firstParty.aria"]}"]`);
    expect(toggle).toBeTruthy();
    await act(async()=>{toggle!.click();await Bun.sleep(25);});
    expect(changed).toBe(true);
    expect(host.textContent!.includes(en["claude.firstParty.shared"])).toBe(warned);
  });
}

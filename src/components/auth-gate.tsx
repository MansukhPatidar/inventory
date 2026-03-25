"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

const PASSWORD_HASH =
  "26f7febda48dd9ac86147c830a5758a2b2d95ddbb85818550c2fd3bf3384a170";
const AUTH_KEY = "inventory_auth";

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") {
      setAuthed(true);
    }
    setChecking(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hash = await sha256(password);
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem(AUTH_KEY, "1");
      setAuthed(true);
    } else {
      setError(true);
      setPassword("");
    }
  };

  if (checking) return null;

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <Lock size={24} className="text-muted-foreground" />
          <h1 className="text-lg font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">Enter password to continue</p>
        </div>
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          className="h-11 text-base bg-card border-border/50 focus-visible:border-primary"
          autoFocus
        />
        {error && (
          <p className="text-xs text-destructive text-center">Wrong password</p>
        )}
        <button
          type="submit"
          className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}

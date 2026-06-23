import React, { useState } from "react";
import { Link } from "wouter";
import { 
  useGetTournaments,
  useCreateTournament,
  useActivateTournament,
  useGetPoolMembers,
  useCreatePoolMember,
  useForceRefresh,
  useGetTournamentField,
  useGetMemberPicks,
  useSavePicks,
  getGetTournamentFieldQueryKey
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";

export default function Admin() {
  const [password, setPassword] = useState(localStorage.getItem("admin_password") || "");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tournaments, refetch: refetchTournaments } = useGetTournaments();
  const { data: poolMembers, refetch: refetchMembers } = useGetPoolMembers();

  const createTournament = useCreateTournament();
  const activateTournament = useActivateTournament();
  const createMember = useCreatePoolMember();
  const forceRefresh = useForceRefresh();
  const savePicks = useSavePicks();

  const [newTourney, setNewTourney] = useState({ name: "", year: new Date().getFullYear(), espnId: "", cutSize: "" });
  const [pgaEvents, setPgaEvents] = useState<{ espnEventId: string; name: string; date: string; state: string | null }[]>([]);
  const [tierTourneyId, setTierTourneyId] = useState("");
  const [tierList, setTierList] = useState<{ golferId: string; name: string; odds: number | null }[]>([]);
  const [tierBreaks, setTierBreaks] = useState<number[]>([]); // up to 4 sorted indices where a new tier starts
  const [tierBusy, setTierBusy] = useState(false);
  const tierListRef = React.useRef<HTMLDivElement>(null);
  const dragK = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/admin/events")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPgaEvents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [isAuthenticated]);
  const [newMember, setNewMember] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [adminMembers, setAdminMembers] = useState<{ id: string; name: string; email: string | null; accessToken: string; submitted: boolean; pickCount: number }[]>([]);
  const [emailDraft, setEmailDraft] = useState<{ [id: string]: string }>({});
  const [lockDraft, setLockDraft] = useState<{ [id: string]: string }>({});
  const [nudging, setNudging] = useState(false);
  const [editingEspnId, setEditingEspnId] = useState<string | null>(null);
  const [editingEspnValue, setEditingEspnValue] = useState("");
  const [editNameValue, setEditNameValue] = useState("");
  const [editYearValue, setEditYearValue] = useState("");
  
  const [pickTourneyId, setPickTourneyId] = useState("");
  const [pickMemberId, setPickMemberId] = useState("");

  const activeTournament = tournaments?.find(t => t.isActive);
  const selectedTourneyEspnId = tournaments?.find(t => t.id === pickTourneyId)?.espnEventId;

  const { data: field } = useGetTournamentField({ espnEventId: selectedTourneyEspnId || "" }, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!selectedTourneyEspnId } as any,
  });

  const { data: existingPicks, refetch: refetchPicks } = useGetMemberPicks(pickTourneyId, pickMemberId, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!pickTourneyId && !!pickMemberId } as any,
  });

  const [selectedGolfers, setSelectedGolfers] = useState<string[]>([]);
  const [pickTiers, setPickTiers] = useState<{ golferId: string; name: string; tier: number; odds: number | null }[]>([]);
  const tieredMode = pickTiers.length > 0;
  const [pickSlots, setPickSlots] = useState<{ [k: string]: string }>({ t1: "", t2: "", t3: "", t4: "", t5: "", extra: "" });

  // Load the selected tournament's tiers — its presence switches to tiered picks
  React.useEffect(() => {
    if (!pickTourneyId) { setPickTiers([]); return; }
    fetch(`/api/admin/tiers?tournamentId=${pickTourneyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPickTiers(Array.isArray(rows) ? rows : []))
      .catch(() => setPickTiers([]));
  }, [pickTourneyId]);

  // Populate selections when picks (or tiers) change
  React.useEffect(() => {
    if (!existingPicks) {
      setSelectedGolfers([]);
      setPickSlots({ t1: "", t2: "", t3: "", t4: "", t5: "", extra: "" });
      return;
    }
    setSelectedGolfers((existingPicks as { id: string }[]).map((p) => p.id));
    if (pickTiers.length) {
      const tierOf = new Map(pickTiers.map((g) => [g.golferId, g.tier]));
      const slots: { [k: string]: string } = { t1: "", t2: "", t3: "", t4: "", t5: "", extra: "" };
      for (const p of existingPicks as { id: string }[]) {
        const t = tierOf.get(p.id);
        if (t === 1) slots.t1 = p.id;
        else if (t === 2) slots.t2 = p.id;
        else if (t === 3) slots.t3 = p.id;
        else if (t === 4) { if (!slots.t4) slots.t4 = p.id; else slots.extra = p.id; }
        else if (t === 5) { if (!slots.t5) slots.t5 = p.id; else slots.extra = p.id; }
      }
      setPickSlots(slots);
    }
  }, [existingPicks, pickTiers]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        toast({ title: "Wrong password", description: "Check your password and try again.", variant: "destructive" });
        return;
      }
      localStorage.setItem("admin_password", password);
      setIsAuthenticated(true);
    } catch {
      toast({ title: "Could not reach server", variant: "destructive" });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_password");
    setIsAuthenticated(false);
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/admin/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        toast({ title: "Backup failed", description: "Could not export data.", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `golf-pool-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded" });
    } catch {
      toast({ title: "Backup failed", description: "Could not reach server.", variant: "destructive" });
    }
  };

  const handle401 = () => {
    handleLogout();
    toast({ title: "Session expired", description: "Password may have changed. Please log in again.", variant: "destructive" });
  };

  const apiErr = (e: unknown) => (e as any)?.data?.error || (e as any)?.message || "An error occurred";
  const isUnauth = (e: unknown) => (e as any)?.status === 401 || (e as any)?.data?.error === "Invalid password";

  // Must be above the early return below — hooks have to run on every render.
  const loadAdminMembers = React.useCallback(() => {
    if (!password) return;
    fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, tournamentId: activeTournament?.id }),
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) {
          setAdminMembers(rows);
          setEmailDraft(Object.fromEntries(rows.map((m: { id: string; email: string | null }) => [m.id, m.email || ""])));
        }
      })
      .catch(() => {});
  }, [password, activeTournament?.id]);

  React.useEffect(() => {
    if (isAuthenticated) loadAdminMembers();
  }, [isAuthenticated, loadAdminMembers]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card p-8 rounded-xl border border-border shadow-2xl space-y-6">
          <h1 className="text-2xl font-bold text-primary uppercase tracking-wider text-center">Admin Access</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full bg-background border-input"
              />
            </div>
            <Button type="submit" disabled={isVerifying} className="w-full uppercase tracking-wider font-bold">
              {isVerifying ? "Checking…" : "Login"}
            </Button>
          </form>
          <div className="text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              &larr; Back to Scoreboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tierAt = (i: number, breaks: number[]) => Math.min(5, 1 + breaks.filter((b) => b <= i).length);

  // up to 4 distinct sorted break indices in [1, len-1]
  const normalizeBreaks = (raw: number[], len: number): number[] => {
    const set = new Set(raw.filter((b) => b >= 1 && b <= len - 1));
    for (let k = 1; k <= 4 && set.size < 4 && len >= 5; k++) {
      const p = Math.round((len * k) / 5);
      if (p >= 1 && p <= len - 1) set.add(p);
    }
    return Array.from(set).sort((a, b) => a - b).slice(0, 4);
  };

  // Default splits: 8 golfers per tier (T1 1-8, T2 9-16, T3 17-24, T4 25-32, T5 33+).
  const evenEight = (len: number): number[] =>
    Array.from(new Set([8, 16, 24, 32].map((p) => Math.min(p, len - 1)).filter((p) => p >= 1))).sort((a, b) => a - b);

  const loadTiers = async (tid: string) => {
    setTierTourneyId(tid);
    setTierList([]);
    setTierBreaks([]);
    if (!tid) return;
    try {
      const res = await fetch(`/api/admin/tiers?tournamentId=${tid}`);
      if (!res.ok) return;
      const rows = await res.json();
      const prob = (a: number | null) => (a == null ? -1 : a >= 0 ? 100 / (a + 100) : -a / (-a + 100));
      if (Array.isArray(rows) && rows.length) {
        rows.sort((a: any, b: any) => a.tier - b.tier || prob(b.odds) - prob(a.odds));
        const list = rows.map((r: any) => ({ golferId: r.golferId, name: r.name, odds: r.odds ?? null }));
        const breaks: number[] = [];
        for (let i = 1; i < rows.length; i++) if (rows[i].tier !== rows[i - 1].tier) breaks.push(i);
        setTierList(list);
        setTierBreaks(normalizeBreaks(breaks, list.length));
      }
    } catch { /* ignore */ }
  };

  const buildTiers = async () => {
    if (!tierTourneyId) return;
    setTierBusy(true);
    try {
      const res = await fetch("/api/admin/tiers/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId: tierTourneyId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) { handle401(); return; }
        toast({ title: "Couldn't build tiers", description: data?.error || "", variant: "destructive" });
        return;
      }
      const list = [
        ...data.matched.map((m: any) => ({ golferId: m.golferId, name: m.name, odds: m.odds })),
        ...data.unmatched.map((u: any) => ({ golferId: u.golferId, name: u.name, odds: null })),
      ];
      setTierList(list);
      setTierBreaks(evenEight(list.length));
      if (data.matched.length === 0) {
        toast({ title: "No odds posted for this event", description: "A major is only priced from ~3 weeks before until it ends. Right now just the upcoming major (The Open) has odds.", variant: "destructive" });
      } else {
        toast({ title: "Tiers built from odds", description: `${data.matched.length} matched · ${data.unmatched.length} unmatched (T5)` });
      }
    } catch {
      toast({ title: "Could not reach server", variant: "destructive" });
    } finally {
      setTierBusy(false);
    }
  };

  // move the divider nearest to gap p (before golfer index p) to p
  const TIER_ROW = 32; // px per row — must match the row height in the list below

  // Move divider k to a new index, clamped strictly between its neighbours so
  // dividers can never cross or coincide (keeps the 4 splits ordered).
  const setDivider = (k: number, idx: number) => {
    setTierBreaks((breaks) => {
      const len = tierList.length;
      const lo = k === 0 ? 1 : breaks[k - 1]! + 1;
      const hi = k === breaks.length - 1 ? len - 1 : breaks[k + 1]! - 1;
      const clamped = Math.max(lo, Math.min(hi, idx));
      if (clamped === breaks[k]) return breaks;
      const next = breaks.slice();
      next[k] = clamped;
      return next;
    });
  };

  const onHandleDown = (k: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragK.current = k;
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const el = tierListRef.current;
    if (dragK.current == null || !el) return;
    const rect = el.getBoundingClientRect();
    setDivider(dragK.current, Math.round((e.clientY - rect.top + el.scrollTop) / TIER_ROW));
    if (e.clientY < rect.top + 24) el.scrollTop -= 12;
    else if (e.clientY > rect.bottom - 24) el.scrollTop += 12;
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (dragK.current != null) e.currentTarget.releasePointerCapture(e.pointerId);
    dragK.current = null;
  };

  const saveTiers = async () => {
    if (!tierTourneyId || !tierList.length) return;
    setTierBusy(true);
    try {
      const assignments = tierList.map((g, i) => ({ golferId: g.golferId, tier: tierAt(i, tierBreaks), odds: g.odds }));
      const res = await fetch("/api/admin/tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId: tierTourneyId, assignments, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) { handle401(); return; }
        toast({ title: "Save failed", description: data?.error || "", variant: "destructive" });
        return;
      }
      if (Array.isArray(data.warnings) && data.warnings.length) {
        toast({ title: `Tiers saved — ${data.warnings.length} team(s) now have invalid picks`, description: data.warnings.slice(0, 4).join(" · "), variant: "destructive" });
      } else {
        toast({ title: "Tiers saved", description: `${data.saved} golfers` });
      }
    } catch {
      toast({ title: "Could not reach server", variant: "destructive" });
    } finally {
      setTierBusy(false);
    }
  };

  const handleSetCutSize = async (tournamentId: string, value: string) => {
    try {
      const res = await fetch(`/api/admin/tournament/${tournamentId}/cut-size`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutSize: value === "off" ? null : parseInt(value), password }),
      });
      if (!res.ok) {
        if (res.status === 401) { handle401(); return; }
        toast({ title: "Could not update cut", variant: "destructive" });
        return;
      }
      toast({ title: "Cut updated" });
      refetchTournaments();
    } catch {
      toast({ title: "Could not reach server", variant: "destructive" });
    }
  };

  const handleCreateTournament = () => {
    createTournament.mutate({
      data: {
        name: newTourney.name,
        year: newTourney.year,
        espnEventId: newTourney.espnId,
        cutSize: newTourney.cutSize ? parseInt(newTourney.cutSize) : null,
        password
      } as any
    }, {
      onSuccess: () => {
        toast({ title: "Tournament Created" });
        refetchTournaments();
        setNewTourney({ name: "", year: new Date().getFullYear(), espnId: "", cutSize: "" });
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error creating tournament", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const handleSaveEdit = async (tournamentId: string) => {
    const body: { password: string; name?: string; year?: number; espnEventId?: string } = { password };
    if (editNameValue.trim()) body.name = editNameValue.trim();
    if (editYearValue.trim() && !isNaN(Number(editYearValue))) body.year = Number(editYearValue.trim());
    if (editingEspnValue.trim()) body.espnEventId = editingEspnValue.trim();
    try {
      const res = await fetch(`/api/admin/tournament/${tournamentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) {
        toast({ title: "Update failed", description: data.error || res.statusText, variant: "destructive" });
        return;
      }
      toast({ title: "Tournament updated" });
      setEditingEspnId(null);
      refetchTournaments();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteTournament = async (tournamentId: string, label: string) => {
    if (!window.confirm(`Delete "${label}" and ALL its data (picks, tiers, scores, submissions)? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/tournament/${tournamentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Delete failed", description: d.error || res.statusText, variant: "destructive" });
        return;
      }
      toast({ title: "Tournament deleted" });
      refetchTournaments();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCreateMember = () => {
    if (!newMember) return;
    fetch("/api/admin/pool-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newMember, email: newMemberEmail || undefined, password }),
    })
      .then(async (r) => {
        if (r.status === 401) { handle401(); return; }
        if (!r.ok) { toast({ title: "Error adding member", variant: "destructive" }); return; }
        toast({ title: "Member Added" });
        refetchMembers();
        loadAdminMembers();
        setNewMember("");
        setNewMemberEmail("");
      })
      .catch(() => toast({ title: "Could not reach server", variant: "destructive" }));
  };

  const saveMemberEmail = (id: string) => {
    fetch(`/api/admin/pool-member/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailDraft[id] ?? "", password }),
    })
      .then((r) => {
        if (r.status === 401) { handle401(); return; }
        if (r.ok) { toast({ title: "Email saved" }); loadAdminMembers(); }
        else toast({ title: "Couldn't save email", variant: "destructive" });
      })
      .catch(() => toast({ title: "Could not reach server", variant: "destructive" }));
  };

  const copyMyLink = (token: string) => {
    const url = `${window.location.origin}/me/${token}`;
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Link copied", description: url }),
      () => toast({ title: "Copy this link", description: url }),
    );
  };

  // ISO timestamp -> value for a <input type="datetime-local"> (local time)
  const toLocalInput = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const clearPicks = (memberId: string, name: string) => {
    if (!activeTournament) { toast({ title: "No active tournament", variant: "destructive" }); return; }
    if (!window.confirm(`Clear ${name}'s picks for ${activeTournament.name}? This deletes their selections and submission for this event.`)) return;
    fetch("/api/admin/clear-picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, tournamentId: activeTournament.id, poolMemberId: memberId }),
    })
      .then((r) => {
        if (r.status === 401) { handle401(); return; }
        if (r.ok) { toast({ title: "Picks cleared", description: `${name} can pick again` }); loadAdminMembers(); }
        else toast({ title: "Couldn't clear picks", variant: "destructive" });
      })
      .catch(() => toast({ title: "Could not reach server", variant: "destructive" }));
  };

  const sendReminders = () => {
    setNudging(true);
    fetch("/api/admin/send-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, baseUrl: window.location.origin }),
    })
      .then(async (r) => {
        if (r.status === 401) { handle401(); return; }
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) {
          toast({ title: "No reminders sent", description: d.reason || "Failed", variant: "destructive" });
          return;
        }
        toast({ title: `Reminders sent: ${d.sent}`, description: `${d.alreadySubmitted} already in · ${d.skippedNoEmail} have no email on file` });
      })
      .catch(() => toast({ title: "Could not reach server", variant: "destructive" }))
      .finally(() => setNudging(false));
  };

  const handleSetLock = (tournamentId: string, localValue: string) => {
    const iso = localValue ? new Date(localValue).toISOString() : null;
    fetch(`/api/admin/tournament/${tournamentId}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picksLockAt: iso, password }),
    })
      .then((r) => {
        if (r.status === 401) { handle401(); return; }
        if (r.ok) { toast({ title: "Pick deadline saved" }); refetchTournaments(); }
        else toast({ title: "Couldn't save deadline", variant: "destructive" });
      })
      .catch(() => toast({ title: "Could not reach server", variant: "destructive" }));
  };

  const handleActivate = (id: string) => {
    activateTournament.mutate({
      tournamentId: id,
      data: { password }
    }, {
      onSuccess: () => {
        toast({ title: "Tournament Activated" });
        refetchTournaments();
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error activating tournament", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const handleForceRefresh = () => {
    if (!activeTournament) return;
    forceRefresh.mutate({
      data: { tournamentId: activeTournament.id, password }
    }, {
      onSuccess: () => toast({ title: "Refresh complete" }),
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error refreshing", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const setSlot = (slot: string, golferId: string) => setPickSlots((s) => ({ ...s, [slot]: golferId }));

  // Golfers eligible for a slot: in the slot's tier(s), not used by another slot,
  // sorted by odds best-first (favorites first; unpriced golfers last). This also
  // orders the combined T4+T5 "Extra" dropdown by odds across both tiers.
  const slotOptions = (tiers: number[], slotKey: string) => {
    const prob = (a: number | null) => (a == null ? -1 : a >= 0 ? 100 / (a + 100) : -a / (-a + 100));
    return pickTiers
      .filter((g) => tiers.includes(g.tier) && (pickSlots[slotKey] === g.golferId || !Object.values(pickSlots).includes(g.golferId)))
      .sort((a, b) => prob(b.odds) - prob(a.odds));
  };

  const handleSavePicks = () => {
    if (!pickTourneyId || !pickMemberId) return;
    const golferIds = tieredMode
      ? [pickSlots.t1, pickSlots.t2, pickSlots.t3, pickSlots.t4, pickSlots.t5, pickSlots.extra].filter(Boolean)
      : selectedGolfers;
    if (golferIds.length !== 6) {
      toast({ title: "Need 6 picks", description: tieredMode ? "Fill all 6 tier slots." : "Select exactly 6 golfers.", variant: "destructive" });
      return;
    }
    savePicks.mutate({
      data: { tournamentId: pickTourneyId, poolMemberId: pickMemberId, golferIds, password },
    }, {
      onSuccess: () => { toast({ title: "Picks Saved" }); refetchPicks(); },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error saving picks", description: apiErr(e), variant: "destructive" });
      },
    });
  };

  const toggleGolfer = (golferId: string) => {
    if (selectedGolfers.includes(golferId)) {
      setSelectedGolfers(selectedGolfers.filter(id => id !== golferId));
    } else {
      if (selectedGolfers.length >= 6) {
        toast({ title: "Limit Reached", description: "You can only select 6 golfers per team", variant: "destructive" });
        return;
      }
      setSelectedGolfers([...selectedGolfers, golferId]);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground p-4 md:p-8 pb-24 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-6">
          <h1 className="text-3xl font-bold text-primary uppercase tracking-widest">Tournament Admin</h1>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={handleExport} className="border-border">Backup</Button>
            <Button variant="outline" onClick={handleLogout} className="border-border">Logout</Button>
            <Link href="/" className="text-muted-foreground hover:text-primary uppercase tracking-widest font-bold text-sm">
              Scoreboard &rarr;
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card className="bg-card border-card-border shadow-lg">
            <CardHeader className="bg-black/20 border-b border-border">
              <CardTitle className="text-xl uppercase tracking-wider text-primary">Tournaments</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-4">
                <h3 className="font-bold uppercase text-sm text-muted-foreground">Create New</h3>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Pick from PGA schedule (optional)</Label>
                    <Select onValueChange={(id) => {
                      const ev = pgaEvents.find((e) => e.espnEventId === id);
                      if (ev) setNewTourney((prev) => ({ ...prev, name: ev.name, year: parseInt(ev.date.slice(0, 4)) || new Date().getFullYear(), espnId: ev.espnEventId }));
                    }}>
                      <SelectTrigger><SelectValue placeholder={pgaEvents.length ? "Choose an event to autofill…" : "Loading PGA schedule…"} /></SelectTrigger>
                      <SelectContent>
                        {pgaEvents.map((e) => (
                          <SelectItem key={e.espnEventId} value={e.espnEventId}>
                            {e.name} — {e.date.slice(0, 10)}{e.state === "in" ? " (live)" : e.state === "post" ? " (done)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tournament Name</Label>
                    <Input value={newTourney.name} onChange={e => setNewTourney({...newTourney, name: e.target.value})} placeholder="e.g. The Masters" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Year</Label>
                      <Input type="number" value={newTourney.year} onChange={e => setNewTourney({...newTourney, year: parseInt(e.target.value)})} />
                    </div>
                    <div className="space-y-2">
                      <Label>ESPN Event ID</Label>
                      <Input value={newTourney.espnId} onChange={e => setNewTourney({...newTourney, espnId: e.target.value})} placeholder="e.g. 401580342" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Cut indicator (optional)</Label>
                    <Select value={newTourney.cutSize || "off"} onValueChange={(v) => setNewTourney({ ...newTourney, cutSize: v === "off" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off (no cut indicator)</SelectItem>
                        <SelectItem value="50">Top 50 — Masters</SelectItem>
                        <SelectItem value="60">Top 60 — US Open</SelectItem>
                        <SelectItem value="70">Top 70 — PGA &amp; The Open</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleCreateTournament} disabled={createTournament.isPending || !newTourney.name || !newTourney.espnId} className="uppercase font-bold tracking-wider">
                    {createTournament.isPending ? "Creating..." : "Create Tournament"}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 pt-6 border-t border-border">
                <h3 className="font-bold uppercase text-sm text-muted-foreground">Existing Tournaments</h3>
                <div className="space-y-2">
                  {tournaments?.map(t => (
                    <div key={t.id} className="p-3 bg-background rounded-md border border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold">{t.name} {t.year}</div>
                          <div className="text-xs text-muted-foreground">ESPN ID: {t.espnEventId || <span className="text-yellow-500">not set</span>}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select value={(t as any).cutSize != null ? String((t as any).cutSize) : "off"} onValueChange={(v) => handleSetCutSize(t.id, v)}>
                            <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="off">Cut: Off</SelectItem>
                              <SelectItem value="50">Top 50</SelectItem>
                              <SelectItem value="60">Top 60</SelectItem>
                              <SelectItem value="70">Top 70</SelectItem>
                            </SelectContent>
                          </Select>
                          {t.isActive ? (
                            <Badge className="bg-primary text-primary-foreground hover:bg-primary uppercase tracking-wider">Active</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleActivate(t.id)} disabled={activateTournament.isPending} className="uppercase text-xs tracking-wider">
                              Set Active
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => {
                            const open = editingEspnId === t.id ? null : t.id;
                            setEditingEspnId(open);
                            setEditingEspnValue(t.espnEventId || "");
                            setEditNameValue(t.name || "");
                            setEditYearValue(String(t.year || ""));
                          }} className="text-xs text-muted-foreground hover:text-primary px-2">
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteTournament(t.id, `${t.name} ${t.year}`)} className="text-xs text-red-400 hover:text-red-300 px-2">
                            Delete
                          </Button>
                        </div>
                      </div>
                      {editingEspnId === t.id && (
                        <div className="flex gap-2 pt-1 flex-wrap items-center">
                          <Input value={editNameValue} onChange={e => setEditNameValue(e.target.value)} placeholder="Name" className="h-8 text-sm bg-input border-border w-40" />
                          <Input value={editYearValue} onChange={e => setEditYearValue(e.target.value)} placeholder="Year" className="h-8 text-sm bg-input border-border w-20" />
                          <Input
                            value={editingEspnValue}
                            onChange={e => setEditingEspnValue(e.target.value)}
                            placeholder="ESPN Event ID"
                            className="h-8 text-sm bg-input border-border w-40"
                            onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(t.id); if (e.key === "Escape") setEditingEspnId(null); }}
                          />
                          <Button size="sm" onClick={() => handleSaveEdit(t.id)} className="h-8 text-xs uppercase tracking-wider">
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingEspnId(null)} className="h-8 text-xs">
                            Cancel
                          </Button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Picks lock</span>
                        <Input
                          type="datetime-local"
                          value={lockDraft[t.id] ?? toLocalInput((t as any).picksLockAt)}
                          onChange={e => setLockDraft({ ...lockDraft, [t.id]: e.target.value })}
                          className="h-8 text-xs bg-input border-border w-[220px]"
                        />
                        <Button size="sm" variant="outline" onClick={() => handleSetLock(t.id, lockDraft[t.id] ?? toLocalInput((t as any).picksLockAt))} className="h-8 text-xs uppercase tracking-wider">Save</Button>
                        {(t as any).picksLockAt && (
                          <Button size="sm" variant="ghost" onClick={() => { setLockDraft({ ...lockDraft, [t.id]: "" }); handleSetLock(t.id, ""); }} className="h-8 text-xs text-muted-foreground">Clear</Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {tournaments?.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">No tournaments found</div>
                  )}
                </div>
              </div>
              
              <div className="pt-6 border-t border-border">
                <Button 
                  variant="outline" 
                  className="w-full uppercase tracking-wider border-primary/50 text-primary hover:bg-primary/10" 
                  onClick={handleForceRefresh}
                  disabled={forceRefresh.isPending || !activeTournament}
                >
                  {forceRefresh.isPending ? "Refreshing..." : "Force ESPN Data Refresh"}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">Refreshes active tournament data immediately</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-card-border shadow-lg">
            <CardHeader className="bg-black/20 border-b border-border">
              <CardTitle className="text-xl uppercase tracking-wider text-primary">Golfer Tiers</CardTitle>
              <CardDescription>Build 5 tiers from the major's winner odds, then adjust. Majors only; unmatched golfers default to T5.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Select value={tierTourneyId} onValueChange={loadTiers}>
                  <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select tournament" /></SelectTrigger>
                  <SelectContent>
                    {tournaments?.map((t: any) => (<SelectItem key={t.id} value={t.id}>{t.name} {t.year}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Button onClick={buildTiers} disabled={!tierTourneyId || tierBusy} className="uppercase font-bold tracking-wider">
                  {tierBusy ? "Working…" : "Build from odds"}
                </Button>
                <Button onClick={saveTiers} disabled={!tierTourneyId || !tierList.length || tierBusy} variant="outline" className="uppercase font-bold tracking-wider border-border">
                  Save tiers
                </Button>
              </div>
              {tierList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Pick a major and "Build from odds" to populate the list (or it loads saved tiers automatically).</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Players stay in odds order. <strong className="text-foreground">Drag a divider line</strong> (or use its ▲▼) to set where each tier splits — amber lines mark the biggest odds gaps. {" "}
                    {[1, 2, 3, 4, 5].map((t) => `T${t}:${tierList.filter((_, i) => tierAt(i, tierBreaks) === t).length}`).join(" · ")}
                  </p>
                  <div ref={tierListRef} className="max-h-[520px] overflow-y-auto rounded border border-border/40 relative select-none">
                    <div className="relative" style={{ height: tierList.length * TIER_ROW }}>
                      {tierList.map((g, i) => {
                        const t = tierAt(i, tierBreaks);
                        const tierBg = ["", "bg-primary/10", "bg-sky-500/10", "bg-emerald-500/10", "bg-amber-500/10", "bg-muted/40"][t];
                        const prob = (x: number | null) => (x == null ? null : x >= 0 ? 100 / (x + 100) : -x / (-x + 100));
                        const prev = i > 0 ? tierList[i - 1] : null;
                        const pa = prev ? prob(prev.odds) : null;
                        const pc = prob(g.odds);
                        const bigGap = pa != null && pc != null && (pa - pc) * 100 >= 1;
                        return (
                          <div
                            key={g.golferId}
                            className={`absolute left-0 right-0 flex items-center justify-between gap-2 text-sm px-2 ${tierBg} ${bigGap ? "border-t border-amber-500/50" : ""}`}
                            style={{ top: i * TIER_ROW, height: TIER_ROW }}
                          >
                            <span className="truncate"><span className="text-muted-foreground text-xs mr-2 tabular-nums">{i + 1}</span>{g.name}</span>
                            <span className="font-mono text-xs text-muted-foreground shrink-0">{g.odds != null ? (g.odds > 0 ? `+${g.odds}` : `${g.odds}`) : "—"}</span>
                          </div>
                        );
                      })}
                      {tierBreaks.map((b, k) => {
                        const prob = (x: number | null) => (x == null ? null : x >= 0 ? 100 / (x + 100) : -x / (-x + 100));
                        const pa = b > 0 ? prob(tierList[b - 1]?.odds ?? null) : null;
                        const pc = prob(tierList[b]?.odds ?? null);
                        const jump = pa != null && pc != null ? Math.round((pa - pc) * 1000) / 10 : null;
                        return (
                          <div
                            key={k}
                            onPointerDown={onHandleDown(k)}
                            onPointerMove={onHandleMove}
                            onPointerUp={onHandleUp}
                            className="absolute left-0 right-0 z-10 flex items-center cursor-grab active:cursor-grabbing"
                            style={{ top: b * TIER_ROW - 11, height: 22, touchAction: "none" }}
                          >
                            <div className="h-0.5 w-full bg-primary" />
                            <div className="absolute right-1 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow">
                              <span>T{k + 1}▕T{k + 2}</span>
                              {jump != null ? <span className="font-normal normal-case opacity-80">{jump}%</span> : null}
                              <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setDivider(k, b - 1); }} className="px-0.5 leading-none hover:opacity-70" title="Up one">▲</button>
                              <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setDivider(k, b + 1); }} className="px-0.5 leading-none hover:opacity-70" title="Down one">▼</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="space-y-8">
            <Card className="bg-card border-card-border shadow-lg">
              <CardHeader className="bg-black/20 border-b border-border">
                <CardTitle className="text-xl uppercase tracking-wider text-primary">Pool Members</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="space-y-2 flex-1 min-w-[140px]">
                    <Label>Name</Label>
                    <Input value={newMember} onChange={e => setNewMember(e.target.value)} placeholder="e.g. John Doe" />
                  </div>
                  <div className="space-y-2 flex-1 min-w-[180px]">
                    <Label>Email (for their pick link)</Label>
                    <Input value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} placeholder="john@example.com" />
                  </div>
                  <Button onClick={handleCreateMember} disabled={!newMember} className="uppercase font-bold tracking-wider">Add</Button>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold uppercase text-sm text-muted-foreground">Members</h3>
                    <div className="flex items-center gap-3">
                      {activeTournament && adminMembers.length > 0 && (
                        <span className="text-xs text-muted-foreground">Submitted: {adminMembers.filter(m => m.submitted).length}/{adminMembers.length}</span>
                      )}
                      <Button size="sm" variant="outline" onClick={sendReminders} disabled={nudging} className="h-7 text-xs uppercase tracking-wider">
                        {nudging ? "Sending…" : "Nudge now"}
                      </Button>
                    </div>
                  </div>
                  {adminMembers.length === 0 && <span className="text-sm text-muted-foreground">No members added yet</span>}
                  {adminMembers.map(m => (
                    <div key={m.id} className="p-3 bg-background rounded-md border border-border space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">{m.name}</span>
                        {activeTournament && (
                          m.submitted
                            ? <span className="text-[10px] rounded bg-primary px-2 py-0.5 text-primary-foreground uppercase tracking-wider">Submitted ✓</span>
                            : <span className="text-[10px] rounded bg-yellow-500/20 text-yellow-500 px-2 py-0.5 uppercase tracking-wider">Not yet ✗</span>
                        )}
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">Email on file: </span>
                        {m.email
                          ? <span className="font-mono">{m.email}</span>
                          : <span className="text-yellow-500">none</span>}
                      </div>
                      <div className="flex gap-2 items-center">
                        <Input
                          value={emailDraft[m.id] ?? (m.email || "")}
                          onChange={e => setEmailDraft({ ...emailDraft, [m.id]: e.target.value })}
                          onKeyDown={e => { if (e.key === "Enter") saveMemberEmail(m.id); }}
                          placeholder="email@example.com"
                          className="h-8 text-sm"
                        />
                        <Button size="sm" variant="outline" onClick={() => saveMemberEmail(m.id)} className="h-8 text-xs uppercase tracking-wider">Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => copyMyLink(m.accessToken)} className="h-8 text-xs uppercase tracking-wider text-muted-foreground hover:text-primary whitespace-nowrap">Copy link</Button>
                      </div>
                      {activeTournament && (m.submitted || m.pickCount > 0) && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-muted-foreground">{m.pickCount} pick{m.pickCount === 1 ? "" : "s"}{m.submitted ? " · submitted" : " · draft"}</span>
                          <Button size="sm" variant="ghost" onClick={() => clearPicks(m.id, m.name)} className="h-7 text-xs text-red-400 hover:text-red-300 uppercase tracking-wider">Clear picks</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border shadow-lg">
              <CardHeader className="bg-black/20 border-b border-border">
                <CardTitle className="text-xl uppercase tracking-wider text-primary">Draft Picks</CardTitle>
                <CardDescription>Select 6 golfers per team</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Tournament</Label>
                    <Select value={pickTourneyId} onValueChange={setPickTourneyId}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue placeholder="Select tournament" />
                      </SelectTrigger>
                      <SelectContent>
                        {tournaments?.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} {t.year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Pool Member</Label>
                    <Select value={pickMemberId} onValueChange={setPickMemberId}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {poolMembers?.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {pickTourneyId && pickMemberId && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold uppercase text-sm text-muted-foreground">
                        {tieredMode ? "Tiered Picks — 1 per tier + 1 extra (T4/T5)" : `Selected Golfers (${selectedGolfers.length}/6)`}
                      </h3>
                      <Button size="sm" onClick={handleSavePicks} disabled={savePicks.isPending} className="uppercase tracking-wider font-bold">
                        {savePicks.isPending ? "Saving..." : "Save Picks"}
                      </Button>
                    </div>

                    {tieredMode ? (
                      <div className="space-y-2">
                        {([
                          ["t1", "T1", [1]],
                          ["t2", "T2", [2]],
                          ["t3", "T3", [3]],
                          ["t4", "T4", [4]],
                          ["t5", "T5", [5]],
                          ["extra", "Extra (T4/T5)", [4, 5]],
                        ] as [string, string, number[]][]).map(([slot, label, tiers]) => (
                          <div key={slot} className="flex items-center gap-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground w-28 shrink-0">{label}</span>
                            <Select value={pickSlots[slot] || ""} onValueChange={(v) => setSlot(slot, v)}>
                              <SelectTrigger className="flex-1"><SelectValue placeholder={`Pick ${label}`} /></SelectTrigger>
                              <SelectContent>
                                {slotOptions(tiers, slot).map((g) => (<SelectItem key={g.golferId} value={g.golferId}>{g.name}{g.odds != null ? ` · ${g.odds > 0 ? "+" : ""}${g.odds}` : ""}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto border border-border rounded-md bg-background p-2 grid grid-cols-1 gap-1">
                        {field?.map(golfer => {
                          const isSelected = selectedGolfers.includes(golfer.id);
                          return (
                            <div
                              key={golfer.id}
                              onClick={() => toggleGolfer(golfer.id)}
                              className={`p-2 rounded cursor-pointer flex justify-between items-center transition-colors ${isSelected ? 'bg-primary/20 border border-primary/50' : 'hover:bg-white/5 border border-transparent'}`}
                            >
                              <span className={isSelected ? "font-bold text-primary" : ""}>{golfer.name}</span>
                              {isSelected && <Badge className="bg-primary">Selected</Badge>}
                            </div>
                          );
                        })}
                        {(!field || field.length === 0) && (
                          <div className="p-4 text-center text-muted-foreground text-sm">
                            Field data not loaded. Make sure the ESPN ID is correct.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

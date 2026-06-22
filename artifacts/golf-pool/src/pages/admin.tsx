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
  React.useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/admin/events")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPgaEvents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [isAuthenticated]);
  const [newMember, setNewMember] = useState("");
  const [editingEspnId, setEditingEspnId] = useState<string | null>(null);
  const [editingEspnValue, setEditingEspnValue] = useState("");
  
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
  const [pickTiers, setPickTiers] = useState<{ golferId: string; name: string; tier: number }[]>([]);
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
      setTierBreaks(normalizeBreaks(data.suggestedBreaks || [], list.length));
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
  const moveBreakNear = (p: number) => {
    setTierBreaks((breaks) => {
      if (breaks.includes(p)) return breaks;
      if (breaks.length < 4) return Array.from(new Set([...breaks, p])).sort((a, b) => a - b);
      let nearest = 0;
      for (let i = 1; i < breaks.length; i++) {
        if (Math.abs(breaks[i]! - p) < Math.abs(breaks[nearest]! - p)) nearest = i;
      }
      return Array.from(new Set(breaks.map((b, i) => (i === nearest ? p : b)))).sort((a, b) => a - b);
    });
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

  const handleUpdateEspnId = async (tournamentId: string) => {
    if (!editingEspnValue.trim()) return;
    try {
      const res = await fetch(`/api/admin/tournament/${tournamentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ espnEventId: editingEspnValue.trim(), password }),
      });
      const data = await res.json();
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) {
        toast({ title: "Error updating ESPN ID", description: data.error || res.statusText, variant: "destructive" });
        return;
      }
      toast({ title: "ESPN ID Updated", description: "Field re-fetched from ESPN." });
      setEditingEspnId(null);
      setEditingEspnValue("");
      refetchTournaments();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCreateMember = () => {
    createMember.mutate({
      data: { name: newMember, password }
    }, {
      onSuccess: () => {
        toast({ title: "Member Added" });
        refetchMembers();
        setNewMember("");
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error adding member", description: apiErr(e), variant: "destructive" });
      }
    });
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

  // Golfers eligible for a slot: in the slot's tier(s) and not used by another slot.
  const slotOptions = (tiers: number[], slotKey: string) =>
    pickTiers.filter(
      (g) => tiers.includes(g.tier) && (pickSlots[slotKey] === g.golferId || !Object.values(pickSlots).includes(g.golferId)),
    );

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
                            setEditingEspnId(editingEspnId === t.id ? null : t.id);
                            setEditingEspnValue(t.espnEventId || "");
                          }} className="text-xs text-muted-foreground hover:text-primary px-2">
                            Edit ID
                          </Button>
                        </div>
                      </div>
                      {editingEspnId === t.id && (
                        <div className="flex gap-2 pt-1">
                          <Input
                            value={editingEspnValue}
                            onChange={e => setEditingEspnValue(e.target.value)}
                            placeholder="ESPN Event ID"
                            className="h-8 text-sm bg-input border-border"
                            onKeyDown={e => { if (e.key === "Enter") handleUpdateEspnId(t.id); if (e.key === "Escape") { setEditingEspnId(null); setEditingEspnValue(""); } }}
                          />
                          <Button size="sm" onClick={() => handleUpdateEspnId(t.id)} disabled={!editingEspnValue.trim()} className="h-8 text-xs uppercase tracking-wider">
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingEspnId(null); setEditingEspnValue(""); }} className="h-8 text-xs">
                            Cancel
                          </Button>
                        </div>
                      )}
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
                    Players stay in odds order — click a gap (or a divider) to move the nearest of the 4 dividers there. Bigger odds jumps are highlighted. {" "}
                    {[1, 2, 3, 4, 5].map((t) => `T${t}:${tierList.filter((_, i) => tierAt(i, tierBreaks) === t).length}`).join(" · ")}
                  </p>
                  <div className="max-h-[520px] overflow-y-auto rounded border border-border/40">
                    {tierList.map((g, i) => {
                      const t = tierAt(i, tierBreaks);
                      const isBreak = tierBreaks.includes(i);
                      const tierBg = ["", "bg-primary/10", "bg-sky-500/10", "bg-emerald-500/10", "bg-amber-500/10", "bg-muted/40"][t];
                      const prob = (x: number | null) => (x == null ? null : x >= 0 ? 100 / (x + 100) : -x / (-x + 100));
                      const prev = i > 0 ? tierList[i - 1] : null;
                      const pa = prev ? prob(prev.odds) : null;
                      const pc = prob(g.odds);
                      const jump = pa != null && pc != null ? Math.round((pa - pc) * 1000) / 10 : null;
                      return (
                        <div key={g.golferId}>
                          {i > 0 &&
                            (isBreak ? (
                              <button onClick={() => moveBreakNear(i)} className="w-full flex items-center justify-center gap-2 px-2 py-0.5 bg-primary/25 border-y border-primary/50 text-[10px] font-bold uppercase tracking-wider text-primary">
                                ── T{t} ──{jump != null ? <span className="text-primary/70 normal-case font-normal">jump {jump}%</span> : null}
                              </button>
                            ) : (
                              <button onClick={() => moveBreakNear(i)} title="Move nearest divider here" className="w-full h-2 flex items-center group">
                                <span className={`h-px w-full ${jump != null && jump >= 1 ? "bg-amber-500/50" : "bg-transparent"} group-hover:bg-primary/60`} />
                              </button>
                            ))}
                          <div className={`flex items-center justify-between gap-2 text-sm px-2 py-1 ${tierBg}`}>
                            <span className="truncate"><span className="text-muted-foreground text-xs mr-2 tabular-nums">{i + 1}</span>{g.name}</span>
                            <span className="font-mono text-xs text-muted-foreground shrink-0">{g.odds != null ? (g.odds > 0 ? `+${g.odds}` : `${g.odds}`) : "—"}</span>
                          </div>
                        </div>
                      );
                    })}
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
                <div className="flex gap-2 items-end">
                  <div className="space-y-2 flex-1">
                    <Label>New Member Name</Label>
                    <Input value={newMember} onChange={e => setNewMember(e.target.value)} placeholder="e.g. John Doe" />
                  </div>
                  <Button onClick={handleCreateMember} disabled={createMember.isPending || !newMember} className="uppercase font-bold tracking-wider">Add</Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-4">
                  {poolMembers?.map(m => (
                    <Badge key={m.id} variant="secondary" className="px-3 py-1 text-sm bg-background border border-border">{m.name}</Badge>
                  ))}
                  {poolMembers?.length === 0 && <span className="text-sm text-muted-foreground">No members added yet</span>}
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
                                {slotOptions(tiers, slot).map((g) => (<SelectItem key={g.golferId} value={g.golferId}>{g.name}</SelectItem>))}
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

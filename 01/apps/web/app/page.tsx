"use client";

import { Activity, AlertTriangle, GitBranch, Lightbulb, Loader2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type Analysis = {
  health_score: number;
  activity_level: "high" | "medium" | "low" | "dead";
  key_metrics: {
    stars_growth_rate: number;
    issue_resolution_rate: number;
    contributor_diversity: number;
  };
  risk_factors: string[];
  opportunities: string[];
  recommendation: "invest" | "watch" | "avoid";
};

type FormState = {
  owner: string;
  repo: string;
  description: string;
  stars: string;
  openIssues: string;
  closedIssuesLast30Days: string;
  commitsLast30Days: string;
  contributorsLast90Days: string;
};

const defaultForm: FormState = {
  owner: "microsoft",
  repo: "vscode",
  description: "Visual Studio Code",
  stars: "170000",
  openIssues: "7000",
  closedIssuesLast30Days: "1200",
  commitsLast30Days: "900",
  contributorsLast90Days: "300"
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Home() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const metrics = useMemo(
    () => [
      { label: "健康分", value: analysis?.health_score ?? "—", icon: ShieldCheck },
      { label: "活跃度", value: formatActivityLevel(analysis?.activity_level), icon: Activity },
      { label: "建议", value: formatRecommendation(analysis?.recommendation), icon: GitBranch }
    ],
    [analysis]
  );

  async function analyzeRepo() {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`${apiUrl}/trpc/github.analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          project: {
            owner: form.owner,
            repo: form.repo,
            description: form.description,
            stars: Number(form.stars),
            openIssues: Number(form.openIssues),
            closedIssuesLast30Days: Number(form.closedIssuesLast30Days),
            commitsLast30Days: Number(form.commitsLast30Days),
            contributorsLast90Days: Number(form.contributorsLast90Days)
          }
        })
      });
      const payload = await response.json();

      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Analyze request failed.");
      }

      setAnalysis(payload.result.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analyze request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="text-base font-semibold">DevScope</div>
          <Button disabled={isLoading} onClick={analyzeRepo} size="sm">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {isLoading ? "分析中" : "分析项目"}
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-10 lg:grid-cols-[380px_1fr]">
        <div>
          <div className="mb-6 max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-normal">GitHub 项目智能分析</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              用结构化模型输出评估仓库健康度、活跃度、风险和机会信号。
            </p>
          </div>

          <div className="rounded-lg border bg-white p-5">
            <div className="grid gap-4">
              <TextInput label="所有者" onChange={(value) => updateField("owner", value)} value={form.owner} />
              <TextInput label="仓库名" onChange={(value) => updateField("repo", value)} value={form.repo} />
              <TextInput
                label="项目描述"
                onChange={(value) => updateField("description", value)}
                value={form.description}
              />
              <NumberInput label="Stars 数" onChange={(value) => updateField("stars", value)} value={form.stars} />
              <NumberInput
                label="当前未解决 Issues"
                onChange={(value) => updateField("openIssues", value)}
                value={form.openIssues}
              />
              <NumberInput
                label="近 30 天关闭 Issues"
                onChange={(value) => updateField("closedIssuesLast30Days", value)}
                value={form.closedIssuesLast30Days}
              />
              <NumberInput
                label="近 30 天 Commits"
                onChange={(value) => updateField("commitsLast30Days", value)}
                value={form.commitsLast30Days}
              />
              <NumberInput
                label="近 90 天贡献者"
                onChange={(value) => updateField("contributorsLast90Days", value)}
                value={form.contributorsLast90Days}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-3">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="rounded-lg border bg-white p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">{metric.label}</div>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-4 text-3xl font-semibold">{metric.value}</div>
                </div>
              );
            })}
          </div>

          {error ? <div className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">{error}</div> : null}

          {analysis ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Metric label="Stars 增长信号" value={analysis.key_metrics.stars_growth_rate} />
                <Metric label="Issue 解决率" value={analysis.key_metrics.issue_resolution_rate} />
                <Metric label="贡献者多样性" value={analysis.key_metrics.contributor_diversity} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InsightList icon={AlertTriangle} items={analysis.risk_factors} title="风险因素" />
                <InsightList icon={Lightbulb} items={analysis.opportunities} title="机会点" />
              </div>
            </>
          ) : (
            <div className="rounded-lg border bg-white p-6 text-sm leading-6 text-muted-foreground">
              填好仓库指标后点击“分析项目”。API 会强制模型使用结构化工具调用，并在展示前用 Zod 校验返回的 JSON。
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function TextInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function NumberInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-4 text-2xl font-semibold">{Math.round(value * 100)}%</div>
    </div>
  );
}

function InsightList({
  icon: Icon,
  items,
  title
}: {
  icon: typeof AlertTriangle;
  items: string[];
  title: string;
}) {
  return (
    <section className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <ul className="grid gap-3 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function formatActivityLevel(value?: Analysis["activity_level"]) {
  const labels = {
    high: "高",
    medium: "中",
    low: "低",
    dead: "停滞"
  };

  return value ? labels[value] : "待分析";
}

function formatRecommendation(value?: Analysis["recommendation"]) {
  const labels = {
    invest: "投入",
    watch: "观察",
    avoid: "规避"
  };

  return value ? labels[value] : "待分析";
}

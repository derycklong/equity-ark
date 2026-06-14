import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ccySymbol, fmtMoneyFull } from "../../lib/utils";
import { useTheme } from "../../lib/theme";

interface NetWorthChartProps {
  ccy: string;
}

function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function NetWorthChart({ ccy }: NetWorthChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const { theme } = useTheme();
  const { data: networthData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["networthHistory"],
    queryFn: () => api.networthHistory(),
    staleTime: 60_000,
  });
  const data = networthData?.history || [];
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  // Track colors in state so they update AFTER the DOM class flip from
  // ThemeProvider's useEffect has been applied.
  const [colors, setColors] = useState(() => ({
    line: cssVar("--color-accent"),
    text: cssVar("--color-ink-dim"),
    grid: cssVar("--color-line"),
    bg: cssVar("--color-bg-card"),
    ink: cssVar("--color-ink"),
    warn: cssVar("--color-warn"),
  }));

  useEffect(() => {
    const readColors = () => ({
      line: cssVar("--color-accent"),
      text: cssVar("--color-ink-dim"),
      grid: cssVar("--color-line"),
      bg: cssVar("--color-bg-card"),
      ink: cssVar("--color-ink"),
      warn: cssVar("--color-warn"),
    });
    setColors(readColors());

    // Watch the <html> element for class changes (theme toggle flips
    // html.dark ↔ html.light, which updates all CSS variables).
    const observer = new MutationObserver(() => {
      setColors(readColors());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [theme]);

  const latest = data[data.length - 1];

  const option = useMemo(() => {
    const dates = data.map((d) => d.date);
    const nwValues = data.map((d) => d.net_worth);
    const flowValues = data.map((d) => d.net_buy_sell);

    const lineColor = colors.line ? `rgb(${colors.line})` : "#60a5fa";
    const textColor = colors.text ? `rgb(${colors.text})` : "#9ca3af";
    const gridColor = colors.grid ? `rgb(${colors.grid})` : "#262632";
    const tooltipBg = colors.bg ? `rgb(${colors.bg})` : "#161a23";
    const tooltipText = colors.ink ? `rgb(${colors.ink})` : "#e5e7eb";

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: tooltipBg,
        borderColor: gridColor,
        textStyle: { color: tooltipText },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue ?? "";
          const nw = params.find((p: any) => p.seriesName === "Net Worth")?.value ?? 0;
          const flow = params.find((p: any) => p.seriesName === "Monthly Buy/Sell")?.value ?? 0;
          return `<div style="font-weight:500">${date}</div>
            <div>Net Worth: <b>${fmtMoneyFull(nw, ccy)}</b></div>
            <div>Monthly Buy/Sell: <b>${fmtMoneyFull(flow, ccy)}</b></div>`;
        },
      },
      legend: {
        show: false,
      },
      grid: { left: "3%", right: "4%", bottom: 30, top: 16, containLabel: true },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: gridColor } },
        axisLabel: { color: textColor },
      },
      yAxis: [
        {
          type: "value",
          scale: true,
          name: "",
          nameTextStyle: { color: textColor },
          axisLine: { show: true, lineStyle: { color: gridColor } },
          axisLabel: { color: textColor, formatter: (v: number) => `${ccySymbol(ccy)}${(v / 1000).toFixed(1)}k` },
          splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
        },
        {
          type: "value",
          position: "right",
          scale: true,
          name: "",
          nameTextStyle: { color: textColor },
          axisLine: { show: true, lineStyle: { color: gridColor } },
          axisLabel: { color: textColor, formatter: (v: number) => `${ccySymbol(ccy)}${(v / 1000).toFixed(1)}k` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Net Worth",
          type: "line",
          yAxisIndex: 0,
          data: nwValues,
          smooth: true,
          showSymbol: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2.5, color: lineColor },
          itemStyle: { color: lineColor },
          areaStyle: {
            color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(96, 165, 250, 0.3)" },
              { offset: 1, color: "rgba(96, 165, 250, 0.02)" },
            ]),
          },
        },
        {
          name: "Monthly Buy/Sell",
          type: "bar",
          yAxisIndex: 1,
          data: flowValues.map((v: number) => ({
            value: v,
            itemStyle: { color: v >= 0 ? "rgba(34, 197, 94, 0.7)" : "rgba(239, 68, 68, 0.7)" },
          })),
        },
      ],
    };
  }, [data, ccy, colors]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }
    chartInstance.current.setOption(option, true);
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [option]);

  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold">Net Worth</h3>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-semibold tabular-nums tracking-tight">
              {fmtMoneyFull(latest?.net_worth ?? 0, ccy)}
            </span>
          </div>
        </div>
        <span className="text-xs text-ink-faint">last 12 months</span>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-ink-dim text-sm">Loading chart…</div>
      ) : error ? (
        <div className="h-64 flex items-center justify-center text-bad text-sm">{error}</div>
      ) : data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-ink-dim text-sm">No data</div>
      ) : (
        <div ref={chartRef} className="h-64 w-full" />
      )}
    </div>
  );
}

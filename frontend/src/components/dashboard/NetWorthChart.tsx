import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { useQuery } from "@tanstack/react-query";
import { Box, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { alpha, useTheme as useMuiTheme } from "@mui/material/styles";
import { api } from "../../lib/api";
import { ccySymbol, fmtMoneyFull } from "../../lib/utils";

interface NetWorthChartProps {
  ccy: string;
}

export default function NetWorthChart({ ccy }: NetWorthChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const theme = useMuiTheme();
  const { data: networthData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["networthHistory"],
    queryFn: () => api.networthHistory(),
    staleTime: 60_000,
  });
  const data = networthData?.history || [];
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  // Track viewport width so the x-axis label format adapts:
  //   <640px  → "Jul" (short month, rotated)
  //   <1024px → "25-07" (year-month, rotated)
  //   else    → "2025-07-26" (full date, horizontal)
  const getWidthBucket = () => {
    if (typeof window === "undefined") return "wide";
    if (window.innerWidth < 640) return "narrow";
    if (window.innerWidth < 1024) return "medium";
    return "wide";
  };
  const [widthBucket, setWidthBucket] = useState<string>(getWidthBucket);
  // Track viewport width so the x-axis label format adapts.
  useEffect(() => {
    const onResize = () => setWidthBucket(getWidthBucket());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const latest = data[data.length - 1];

  const option = useMemo(() => {
    const dates = data.map((d) => d.date);
    const nwValues = data.map((d) => d.net_worth);
    const flowValues = data.map((d) => d.net_buy_sell);

     const lineColor = theme.palette.primary.main;
     const textColor = theme.palette.text.secondary;
     const gridColor = alpha(theme.palette.divider, 0.68);
     const tooltipBg = theme.palette.background.paper;
     const tooltipText = theme.palette.text.primary;
     const axisText = alpha(theme.palette.text.secondary, 0.9);

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: { color: alpha(theme.palette.primary.main, 0.38), width: 1 },
        },
        backgroundColor: tooltipBg,
        borderColor: gridColor,
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: tooltipText, fontFamily: "var(--app-font-family)", fontSize: 12 },
        extraCssText: "border-radius: 10px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);",
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue ?? "";
          const nw = params.find((p: any) => p.seriesName === "Net Worth")?.value ?? 0;
          const flow = params.find((p: any) => p.seriesName === "Monthly Buy/Sell")?.value ?? 0;
          return `<div style="font-weight:700;margin-bottom:6px">${date}</div>
            <div style="margin:3px 0"><span style="color:${lineColor}">●</span> Net worth: <b>${fmtMoneyFull(nw, ccy)}</b></div>
            <div style="margin:3px 0"><span style="color:${alpha(theme.palette.success.main, 0.9)}">●</span> Monthly buy/sell: <b>${fmtMoneyFull(flow, ccy)}</b></div>`;
        },
      },
      legend: {
        show: false,
      },
      grid: { left: "2.5%", right: "2.5%", bottom: widthBucket === "wide" ? 30 : 50, top: 14, containLabel: true },
      xAxis: {
        type: "category",
        data: dates,
         axisLine: { show: false },
         axisTick: { show: false },
         axisLabel: {
           color: axisText,
           margin: 12,
          // Rotate labels on smaller viewports so they don't squash together.
          rotate: widthBucket === "wide" ? 0 : 35,
          // Always hide overlapping labels as a final safety net — ECharts
          // measures bounding boxes and skips any that would collide.
          hideOverlap: true,
          formatter: (value: string) => {
            // value is "YYYY-MM-DD"
            const [y, m] = value.split("-");
            if (widthBucket === "narrow") {
              const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
              const idx = parseInt(m, 10) - 1;
              return monthNames[idx] ?? value;
            }
            if (widthBucket === "medium") {
              return `${y.slice(2)}-${m}`;
            }
            return value;
          },
        },
      },
      yAxis: [
        {
          type: "value",
          scale: true,
          name: "",
          nameTextStyle: { color: textColor },
           axisLine: { show: false },
           axisTick: { show: false },
           axisLabel: { color: axisText, margin: 12, formatter: (v: number) => `${ccySymbol(ccy)}${(v / 1000).toFixed(1)}k` },
           splitLine: { lineStyle: { color: gridColor, type: "dashed", width: 1 } },
        },
        {
          type: "value",
          position: "right",
          scale: true,
          name: "",
          nameTextStyle: { color: textColor },
           axisLine: { show: false },
           axisTick: { show: false },
           axisLabel: { color: axisText, margin: 12, formatter: (v: number) => `${ccySymbol(ccy)}${(v / 1000).toFixed(1)}k` },
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
           symbolSize: 7,
           lineStyle: { width: 3, color: lineColor, cap: "round", join: "round" },
           itemStyle: { color: lineColor, borderColor: theme.palette.background.paper, borderWidth: 2 },
           emphasis: { focus: "series", scale: true, itemStyle: { borderWidth: 3 } },
           label: {
             show: widthBucket === "wide",
             position: "top",
             distance: 8,
             color: textColor,
             fontSize: 10,
             fontWeight: 600,
             backgroundColor: tooltipBg,
             borderColor: gridColor,
             borderWidth: 1,
             borderRadius: 4,
             padding: [3, 5],
             formatter: (params: any) => {
               const value = Number(params.value);
               const sign = value < 0 ? "-" : "";
               return `${sign}${ccySymbol(ccy)}${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
             },
           },
          areaStyle: {
              color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
               { offset: 0, color: alpha(theme.palette.primary.main, 0.3) },
               { offset: 1, color: alpha(theme.palette.primary.main, 0.02) },
            ]),
          },
        },
        {
          name: "Monthly Buy/Sell",
          type: "bar",
          yAxisIndex: 1,
          data: flowValues.map((v: number) => ({
            value: v,
             itemStyle: {
               color: v >= 0 ? alpha(theme.palette.success.main, 0.58) : alpha(theme.palette.error.main, 0.58),
               borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
             },
          })),
          barMaxWidth: 28,
          emphasis: { focus: "series" },
        },
      ],
    };
  }, [data, ccy, theme, widthBucket]);

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
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, mb: 1.25 }}>
          <Box>
            <Typography variant="h3">Net worth</Typography>
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mt: 0.25, fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(latest?.net_worth ?? 0, ccy)}</Typography>
            <Stack direction="row" spacing={1.25} sx={{ mt: 0.75, alignItems: "center", flexWrap: "wrap" }}>
              <ChartLegend color={theme.palette.primary.main} label="Net worth" />
              <ChartLegend color={theme.palette.success.main} label="Monthly buy/sell" />
            </Stack>
          </Box>
          <Chip size="small" variant="outlined" label="Last 12 months" sx={{ height: 24, fontSize: "0.68rem" }} />
        </Stack>

      {loading ? (
        <Box sx={{ height: { xs: 224, sm: 256, md: 288 }, display: "flex", alignItems: "center", justifyContent: "center" }}><Typography variant="body2" color="text.secondary">Loading chart…</Typography></Box>
      ) : error ? (
        <Box sx={{ height: { xs: 224, sm: 256, md: 288 }, display: "flex", alignItems: "center", justifyContent: "center" }}><Typography variant="body2" color="error">{error}</Typography></Box>
      ) : data.length === 0 ? (
        <Box sx={{ height: { xs: 224, sm: 256, md: 288 }, display: "flex", alignItems: "center", justifyContent: "center" }}><Typography variant="body2" color="text.secondary">No data</Typography></Box>
      ) : (
        <Box ref={chartRef} sx={{ height: { xs: 224, sm: 256, md: 288 }, width: "100%" }} />
      )}
      </CardContent>
    </Card>
  );
}

function ChartLegend({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

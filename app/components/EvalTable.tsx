import results from "@/eval/results.json";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export default function EvalTable() {
  const rows = results.rows;
  const best = Math.max(...rows.map((r) => r.recall5));
  return (
    <div className="overflow-x-auto rounded-xl border border-edge">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Retrieval quality for each configuration on {results.questions} questions</caption>
        <thead className="bg-panel text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Configuration</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Recall@1</th>
            <th scope="col" className="px-3 py-3 font-medium">Recall@5</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">MRR@10</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Latency</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {rows.map((r) => (
            <tr key={r.config} className={r.recall5 === best ? "bg-emerald-950/30" : undefined}>
              <th scope="row" className="px-4 py-3 font-normal text-gray-200">{r.config}</th>
              <td className="px-3 py-3 text-right font-mono text-gray-300">{pct(r.recall1)}</td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <svg width="120" height="8" role="presentation" aria-hidden="true">
                    <rect width="120" height="8" rx="4" fill="#1f2937" />
                    <rect width={Math.round(120 * r.recall5)} height="8" rx="4" fill={r.recall5 === best ? "#34d399" : "#6b7280"} />
                  </svg>
                  <span className="font-mono text-gray-200">{pct(r.recall5)}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-right font-mono text-gray-300">{r.mrr10.toFixed(2)}</td>
              <td className="px-3 py-3 text-right font-mono text-gray-400">{r.medianLatencyMs < 1 ? "<1" : r.medianLatencyMs} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

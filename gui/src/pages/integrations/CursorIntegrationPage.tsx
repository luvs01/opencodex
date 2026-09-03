import { useCallback, useEffect, useRef, useState } from "react";
import { useDataSurface } from "../../data-surface";
import { DataSurfaceSkeleton } from "../../components/data-surface";
import { formatTokens } from "../../format-tokens";
import { navigateHash } from "../../hash-routing";
import { useI18n, useT, type TKey } from "../../i18n/shared";
import { Notice } from "../../ui";
import { loadCursorIntegrationStatus, type CursorIntegrationStatus } from "./cursor-api";

/**
 * The Cursor tab is a read-only companion, not a switch.
 *
 * Cursor Private Inference keeps its gateway settings in a SQLite database the running app
 * rewrites and its API key in the OS keychain, both out of bounds for this proxy. So the page
 * does the three things it can do honestly: say which Cursor builds are installed, hand the
 * user the two values Cursor's own form wants, and predict the model controls it will render.
 * Everything shown is a GET of one status route.
 */

function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="cursor-gateway-row">
      <span className="cursor-gateway-label">{label}</span>
      <code className="cursor-gateway-value">{value}</code>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()} aria-label={`${t("integrations.cursor.copy")} ${label}`}>
        {t(copied ? "integrations.cursor.copied" : "integrations.cursor.copy")}
      </button>
    </div>
  );
}

function DetectionRow({ labelKey, installed, path, version }: { labelKey: TKey; installed: boolean; path: string | null; version: string | null }) {
  const t = useT();
  return (
    <div className="cursor-detect-row" data-installed={installed ? "true" : "false"}>
      <span className="cursor-detect-name">{t(labelKey)}</span>
      <span className={`badge ${installed ? "badge-green" : "badge-muted"}`}>
        {t(installed ? "integrations.cursor.detected" : "integrations.cursor.notFound")}
      </span>
      {installed && path && (
        <span className="cursor-detect-path muted">{version ? `${version} · ` : ""}{path}</span>
      )}
    </div>
  );
}

export default function CursorIntegrationPage({ apiBase, active }: { apiBase: string; active: boolean }) {
  const { t, locale } = useI18n();
  const fetchStatus = useCallback(
    async (signal: AbortSignal) => {
      const payload = await loadCursorIntegrationStatus(apiBase, signal);
      // The overview paints a null read as "unknown"; the page has room to say why.
      if (!payload) throw new Error("cursor status unavailable");
      return payload;
    },
    [apiBase],
  );
  // Poll while the tab is open so install and catalog changes show up without a reload.
  const resource = useDataSurface<CursorIntegrationStatus>(
    `integration-cursor-page:${apiBase}`,
    [apiBase],
    fetchStatus,
    { isEmpty: () => false, enabled: active, pollMs: 15_000, pauseWhenHidden: true },
  );
  const status = resource.state.data ?? null;
  return (
    <section className="integration-native-page cursor-page" aria-labelledby="cursor-integration-title">
      <h3 id="cursor-integration-title">{t("integrations.cursor.title")}</h3>
      <p>{t("integrations.cursor.intro")}</p>

      {resource.state.showError && <Notice tone="err">{t("integrations.cursor.unavailable")}</Notice>}
      {!status && !resource.state.showError && <DataSurfaceSkeleton label={t("integrations.cursor.loading")} rows={4} />}

      {status && (
        <>
          <div className="cursor-card">
            <h4>{t("integrations.cursor.detection")}</h4>
            <DetectionRow labelKey="integrations.cursor.privateInference" installed={status.privateInference.installed} path={status.privateInference.path} version={status.privateInference.version} />
            <DetectionRow labelKey="integrations.cursor.regular" installed={status.regularCursor.installed} path={status.regularCursor.path} version={null} />
            {!status.privateInference.installed && (
              <Notice tone="warn">
                {t(status.regularCursor.installed ? "integrations.cursor.regularOnly" : "integrations.cursor.nothingFound")}
                {" "}
                <a href={status.guideUrl} target="_blank" rel="noreferrer" data-cursor-guide="notice">{t("integrations.cursor.guide")}</a>
              </Notice>
            )}
          </div>

          <div className="cursor-card">
            <h4>{t("integrations.cursor.gateway")}</h4>
            <p className="muted">{t("integrations.cursor.gatewayHint")}</p>
            <CopyValue label={t("integrations.cursor.baseUrl")} value={status.gateway.baseUrl} />
            {status.gateway.apiKeyMode === "placeholder"
              ? <CopyValue label={t("integrations.cursor.apiKey")} value={status.gateway.placeholder} />
              : (
                <div className="cursor-gateway-row">
                  <span className="cursor-gateway-label">{t("integrations.cursor.apiKey")}</span>
                  <span className="cursor-gateway-value">{t("integrations.cursor.apiKeyCredential")}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigateHash("integrations/keys")}>
                    {t("integrations.tab.keys")}
                  </button>
                </div>
              )}
          </div>

          <div className="cursor-card">
            <h4>{t("integrations.cursor.models")}</h4>
            <p className="muted">{t("integrations.cursor.modelsHint")}</p>
            <table className="cursor-model-table">
              <thead>
                <tr>
                  <th>{t("integrations.cursor.colModel")}</th>
                  <th>{t("integrations.cursor.colReasoning")}</th>
                  <th>{t("integrations.cursor.colContext")}</th>
                </tr>
              </thead>
              <tbody>
                {status.models.map(model => (
                  <tr key={model.id}>
                    <td><code>{model.id}</code></td>
                    <td>{model.reasoning ? model.reasoning.join(" · ") : "—"}</td>
                    <td>{model.context ? `${formatTokens(model.context.defaultWindow, locale)} · ${formatTokens(model.context.longWindow, locale)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>
            <a href={status.guideUrl} target="_blank" rel="noreferrer">{t("integrations.cursor.guide")}</a>
          </p>
        </>
      )}
    </section>
  );
}

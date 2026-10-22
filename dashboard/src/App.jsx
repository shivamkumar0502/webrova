/**
 * App.jsx — Mission Control Dashboard
 * 
 * Industrial dark UI. No emojis. Clean typography.
 * Layout: header -> requirement bar -> pipeline -> columns (log | output) -> token bar
 */

import { useState, useCallback } from "react";
import useProjectStore from "./store/projectStore";
import useWebSocket from "./hooks/useWebSocket";
import { createProject, resumeProject } from "./lib/api";
import PipelineVisualizer from "./components/PipelineVisualizer";
import LogStream from "./components/LogStream";
import OutputPanel from "./components/OutputPanel";
import HumanInputPanel from "./components/HumanInputPanel";
import BuildBrief from "./components/BuildBrief";
import WorkspaceFiles from "./components/WorkspaceFiles";
import AccessGate from "./components/AccessGate";
import TokenBudgetBar from "./components/TokenBudgetBar";

export default function App() {
  const [requirementInput, setRequirementInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [budget, setBudget] = useState(1);

  const projectId = useProjectStore((s) => s.projectId);
  const requirement = useProjectStore((s) => s.requirement);
  const status = useProjectStore((s) => s.status);
  const wsConnected = useProjectStore((s) => s.wsConnected);
  const humanInputRequest = useProjectStore((s) => s.humanInputRequest);
  const error = useProjectStore((s) => s.error);
  const errorRecoverable = useProjectStore((s) => s.errorRecoverable);
  const setProject = useProjectStore((s) => s.setProject);
  const reset = useProjectStore((s) => s.reset);

  const { sendMessage, disconnect } = useWebSocket(projectId);

  const handleStart = useCallback(async (brief) => {
    if (!requirementInput.trim() || isStarting) return;
    setIsStarting(true);
    try {
      const result = await createProject(typeof brief === "string" ? brief : requirementInput.trim(), budget);
      setProject(result.projectId, requirementInput.trim());
      useProjectStore.setState({ tokenBudget: budget });
      setRequirementInput("");
    } catch (e) {
      alert(`Failed to start project: ${e.message}`);
    } finally {
      setIsStarting(false);
    }
  }, [requirementInput, setProject, budget, isStarting]);

  const handleHumanResponse = useCallback(
    (data) => {
      sendMessage({ type: "human_response", data });
      useProjectStore.setState({ status: "running", humanInputRequest: null });
    },
    [sendMessage]
  );

  const handleCancel = useCallback(() => {
    sendMessage({ type: "cancel" });
  }, [sendMessage]);

  const handleResume = useCallback(async () => {
    if (!projectId) return;
    try {
      useProjectStore.setState({ status: "running", error: null, errorRecoverable: false });
      await resumeProject(projectId);
    } catch (e) {
      useProjectStore.setState({ status: "error", error: `Resume failed: ${e.message}` });
    }
  }, [projectId]);

  const handleNewProject = useCallback(() => {
    disconnect();
    reset();
  }, [disconnect, reset]);

  return (
    <AccessGate><div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-mark">//</span>
            <span className="logo-text">Webrova</span>
          </div>
          <span className="header-divider" />
          <span className="header-label">mission control</span>
        </div>
        <div className="header-right">
          <div className="conn-indicator">
            <span className={`conn-dot ${wsConnected ? "live" : ""}`} />
            <span className="conn-label">{wsConnected ? "CONNECTED" : "OFFLINE"}</span>
          </div>
          {projectId && (
            <button className="btn btn-text" onClick={handleNewProject}>
              NEW PROJECT
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {!projectId ? (
          <div className="landing">
            <div className="landing-inner">
              <div className="landing-left">
                <p className="landing-pre">MULTI-AGENT AI SYSTEM</p>
                <h1 className="landing-title">
                  Describe it.<br />
                  We build it.
                </h1>
                <p className="landing-desc">
                  An AI team for your frontend, backend and database.
                  Shape the brief, follow the build, and inspect every file.
                </p>
              </div>
              <div className="landing-right">
                <BuildBrief value={requirementInput} onChange={setRequirementInput} budget={budget} onBudgetChange={setBudget} busy={isStarting} onLaunch={handleStart} />
              </div>
            </div>
          </div>
        ) : (
          <div className="dashboard">
            <div className="req-bar">
              <div className="req-bar-left">
                <span className="req-label">TARGET</span>
                <span className="req-text">{requirement}</span>
              </div>
              <div className="req-bar-right">
                <span className={`status-pill status--${status}`}>
                  {status === "running" && "RUNNING"}
                  {status === "waiting_input" && "AWAITING INPUT"}
                  {status === "complete" && "COMPLETE"}
                  {status === "error" && "ERROR"}
                  {status === "cancelled" && "CANCELLED"}
                  {status === "idle" && "IDLE"}
                </span>
                {status === "running" && (
                  <button className="btn btn-text btn-sm" onClick={handleCancel}>
                    ABORT
                  </button>
                )}
                {status === "error" && errorRecoverable && (
                  <button className="btn btn-accent btn-sm" onClick={handleResume}>
                    RETRY
                  </button>
                )}
              </div>
            </div>

            {status === "error" && error && (
              <div className="error-bar">
                <span className="error-bar-label">ERROR</span>
                <span className="error-bar-msg">{error}</span>
                {errorRecoverable && (
                  <span className="error-bar-hint">Checkpointed. Click RETRY to resume from last good state.</span>
                )}
              </div>
            )}

            <PipelineVisualizer />

            <div className="dashboard-grid">
              <div className="dashboard-col">
                <LogStream />
              </div>
              <div className="dashboard-col">
                <OutputPanel />
              </div>
            </div>

            {humanInputRequest && (
              <HumanInputPanel
                request={humanInputRequest}
                onSubmit={handleHumanResponse}
              />
            )}

            <WorkspaceFiles projectId={projectId} status={status} />
            <TokenBudgetBar />
          </div>
        )}
      </main>
    </div></AccessGate>
  );
}
import { useMemo, useState, useEffect } from 'react';
import { parsePlannerWorkbook, parseAFazerWorkbook, parsePendentesWorkbook, parseConcluidasWorkbook } from './utils/plannerParser';
import GanttChart from './components/GanttChart';

const BACKEND_DEVS = ['Augusto', 'Diego', 'Rhaniery', 'Dieter'];
const DEPENDENCY_BACKEND_DEVS = ['Augusto', 'Dieter'];
const OTHER_BACKEND_DEVS = ['Rhaniery', 'Diego'];
const FRONTEND_DEVS = ['Pablo', 'Daniel'];
const AUTOMATION_DEV = 'Ivan Cavalcanti Pinto';

function getShortName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 2
    ? `${parts[0]} ${parts[parts.length - 1]}`
    : fullName;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaskBaseName(title) {
  return String(title || '')
    .replace(/\[(backend|frontend|automac[aã]o|testes?\s*front-?end)\]/gi, '')
    .trim();
}

function getDependencyKey(title) {
  const rawTitle = String(title || '');

  // Prefer the descriptive segment after [Backend]/[Frontend], which is stable across IDs.
  const afterTagMatch = rawTitle.match(
    /\[(backend|frontend|automac[aã]o|testes?\s*front-?end)\]\s*-\s*(.+)$/i
  );

  const candidate = afterTagMatch ? afterTagMatch[2] : getTaskBaseName(rawTitle);

  return normalizeText(
    candidate
      // Remove common planner prefixes like "SMS -2282122-"
      .replace(/^[a-z]+\s*-\s*\d+\s*-\s*/i, '')
      // Remove any remaining numeric tokens around separators at the beginning.
      .replace(/^\d+\s*-\s*/i, '')
  );
}

function isTargetBucket(bucketValue) {
  const normalized = normalizeText(bucketValue);

  if (normalized === 'tarefas pendentes' || normalized === 'a fazer' || normalized === 'pendentes') {
    return true;
  }

  // Accept singular/plural and minor wording variations around "pagina(s)" + "configurac(ao/oes)"
  const hasPagina = normalized.includes('pagina');
  const hasConfiguracaoRoot = normalized.includes('configurac');
  return hasPagina && hasConfiguracaoRoot;
}

function detectTypeFromTitle(title) {
  const match = String(title || '').match(
    /\[(frontend|backend|automac[aã]o|testes?\s*front-?end)\]/i
  );

  if (!match) {
    return '';
  }

  const normalized = normalizeText(match[1]);
  if (normalized === 'backend') {
    return 'backend';
  }

  return 'frontend';
}

function isAutomationTask(title) {
  return /\[\s*automac[aã]o\s*\]/i.test(String(title || ''));
}

function isTestTask(title) {
  return /\[\s*testes?/i.test(String(title || ''));
}

function isConcludedTask(task) {
  if (task.source === 'concluidas') return true;
  const progressOrStatus = normalizeText(task.progress || task.status);
  return progressOrStatus.startsWith('concluid') || progressOrStatus.startsWith('liberado');
}

function isWaitingEnvironment(task) {
  const combined = normalizeText(
    `${task.bucket || ''} ${task.status || ''} ${task.progress || ''}`
  );
  return combined.includes('aguardando ambiente testes');
}

function isNotConcludedBucket(bucketValue) {
  const normalized = normalizeText(bucketValue);
  if (!normalized) return false;

  if (normalized === 'tarefas pendentes' || normalized === 'a fazer' || normalized === 'pendentes') {
    return true;
  }

  return normalized === 'paginas de configuracoes';
}

function isNotStartedProgress(task) {
  const normalized = normalizeText(task.progress || task.status);
  return normalized.startsWith('nao inici') || normalized === 'a fazer';
}

function isTrackedPendingTask(task) {
  return isNotConcludedBucket(task.bucket) && isNotStartedProgress(task);
}

function isInProgressTask(task) {
  const normalizedStatus = normalizeText(task.status);
  const normalizedProgress = normalizeText(task.progress);
  const normalizedBucket = normalizeText(task.bucket);

  return (
    normalizedStatus.includes('em andamento') ||
    normalizedProgress.includes('em andamento') ||
    normalizedBucket === 'fazendo'
  );
}

function isConfigPagesBucket(bucketValue) {
  return normalizeText(bucketValue) === 'paginas de configuracoes';
}

const EMPTY_SOURCE = { fileName: '', tasks: [] };

function loadSource(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : EMPTY_SOURCE;
  } catch {
    return EMPTY_SOURCE;
  }
}

function App() {
  const [aFazerSource, setAFazerSource] = useState(() => loadSource('pm_afazer'));
  const [pendentesSource, setPendentesSource] = useState(() => loadSource('pm_pendentes'));
  const [concluidasSource, setConcluidasSource] = useState(() => loadSource('pm_concluidas'));
  const [tasks, setTasks] = useState(() => {
    const a = loadSource('pm_afazer');
    const p = loadSource('pm_pendentes');
    const c = loadSource('pm_concluidas');
    return [...a.tasks, ...p.tasks, ...c.tasks];
  });
  const [error, setError] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedResources, setSelectedResources] = useState([]);
  const [showOnlyDependentFrontend, setShowOnlyDependentFrontend] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [distributionSummary, setDistributionSummary] = useState('');
  const [activeTab, setActiveTab] = useState('tasks');
  const [isOptimizedMode, setIsOptimizedMode] = useState(false);

  function toggleOpenFilter(filterKey) {
    setOpenFilter((prev) => (prev === filterKey ? null : filterKey));
  }

  useEffect(() => {
    try { localStorage.setItem('pm_afazer', JSON.stringify(aFazerSource)); } catch {}
  }, [aFazerSource]);

  useEffect(() => {
    try { localStorage.setItem('pm_pendentes', JSON.stringify(pendentesSource)); } catch {}
  }, [pendentesSource]);

  useEffect(() => {
    try { localStorage.setItem('pm_concluidas', JSON.stringify(concluidasSource)); } catch {}
  }, [concluidasSource]);

  function clearAllSources() {
    localStorage.removeItem('pm_afazer');
    localStorage.removeItem('pm_pendentes');
    localStorage.removeItem('pm_concluidas');
    setAFazerSource(EMPTY_SOURCE);
    setPendentesSource(EMPTY_SOURCE);
    setConcluidasSource(EMPTY_SOURCE);
    setTasks([]);
    resetFiltersAndDistribution();
  }

  function handleGanttResourceChange(changes) {
    // changes: Array<{ taskKey: string, newResource: string }>
    const changeMap = new Map(changes.map((c) => [c.taskKey, c.newResource]));
    setTasks((prevTasks) =>
      prevTasks.map((task) => {
        const key = `${task.line}-${task.title}`;
        if (changeMap.has(key)) {
          return { ...task, resource: changeMap.get(key) };
        }
        return task;
      })
    );
  }

  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(tasks.map((t) => t.status).filter(Boolean));
    return Array.from(statuses).sort();
  }, [tasks]);

  const uniqueTypes = useMemo(() => {
    const types = new Set(tasks.map((t) => t.type).filter(Boolean));
    return Array.from(types).sort();
  }, [tasks]);

  const uniqueResources = useMemo(() => {
    const resourceSet = new Set();
    tasks.forEach((task) => {
      if (task.resource) {
        // Split by semicolon in case multiple people are assigned
        const names = task.resource
          .split(';')
          .map((name) => name.trim())
          .filter(Boolean);
        names.forEach((name) => resourceSet.add(name));
      }
    });
    return Array.from(resourceSet).sort();
  }, [tasks]);

  const dependentFrontendTaskKeys = useMemo(() => {
    const groupedByBase = new Map();

    tasks.forEach((task) => {
      const normalizedType = normalizeText(task.type) || detectTypeFromTitle(task.title);
      if (normalizedType !== 'backend' && normalizedType !== 'frontend') {
        return;
      }

      const baseName = getDependencyKey(task.title);
      if (!groupedByBase.has(baseName)) {
        groupedByBase.set(baseName, { backendCount: 0, frontendKeys: [] });
      }

      const entry = groupedByBase.get(baseName);
      const taskKey = `${task.line}-${task.title}`;

      if (normalizedType === 'backend') {
        entry.backendCount += 1;
      } else {
        entry.frontendKeys.push(taskKey);
      }
    });

    const dependentKeys = new Set();
    groupedByBase.forEach((entry) => {
      if (entry.backendCount > 0) {
        entry.frontendKeys.forEach((key) => dependentKeys.add(key));
      }
    });

    return dependentKeys;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (selectedStatuses.length > 0) {
      const nonConcludedStatusSelected = selectedStatuses.some((status) => {
        const normalizedStatus = normalizeText(status);
        return (
          normalizedStatus.includes('nao conclu') ||
          normalizedStatus.startsWith('nao inici')
        );
      });

      const inProgressStatusSelected = selectedStatuses.some(
        (status) => normalizeText(status) === 'em andamento'
      );

      const explicitStatuses = selectedStatuses.filter((status) => {
        const normalizedStatus = normalizeText(status);
        return !(
          normalizedStatus.includes('nao conclu') ||
          normalizedStatus.startsWith('nao inici')
        );
      });

      result = result.filter((task) => {
        const matchesExplicitStatus = explicitStatuses.includes(task.status);
        const matchesNotConcluded =
          nonConcludedStatusSelected &&
          isNotConcludedBucket(task.bucket) &&
          isNotStartedProgress(task);
        const matchesInProgress =
          inProgressStatusSelected && isInProgressTask(task);

        return matchesExplicitStatus || matchesNotConcluded || matchesInProgress;
      });
    }

    if (selectedTypes.length > 0) {
      result = result.filter((task) => selectedTypes.includes(task.type));
    }

    if (selectedResources.length > 0) {
      result = result.filter((task) => {
        if (!task.resource) return false;
        return selectedResources.some((resource) =>
          task.resource.includes(resource)
        );
      });
    }

    if (showOnlyDependentFrontend) {
      result = result.filter((task) =>
        dependentFrontendTaskKeys.has(`${task.line}-${task.title}`)
      );
    }

    return result;
  }, [
    tasks,
    selectedStatuses,
    selectedTypes,
    selectedResources,
    showOnlyDependentFrontend,
    dependentFrontendTaskKeys,
  ]);

  const stats = useMemo(() => {
    const withId = filteredTasks.filter((task) => task.id !== null).length;
    const trackedPending = filteredTasks.filter(isTrackedPendingTask).length;
    return {
      total: filteredTasks.length,
      withId,
      withoutId: filteredTasks.length - withId,
      trackedPending,
    };
  }, [filteredTasks]);

  const progress = useMemo(() => {
    const total = tasks.length;
    if (total === 0) return null;
    const concluidas = tasks.filter(isConcludedTask).length;
    const afazer = tasks.filter((t) => t.source === 'afazer').length;
    const pendentes = tasks.filter((t) => t.source === 'pendentes').length;
    const donePct = Math.round((concluidas / total) * 100);
    const pendPct = Math.round(((afazer + pendentes) / total) * 100);
    return { total, concluidas, afazer, pendentes, donePct, pendPct };
  }, [tasks]);

  function toggleStatusFilter(status) {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  }

  function toggleTypeFilter(type) {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  }

  function toggleResourceFilter(resource) {
    setSelectedResources((prev) =>
      prev.includes(resource)
        ? prev.filter((r) => r !== resource)
        : [...prev, resource]
    );
  }

  function toggleDependentFrontendFilter() {
    setShowOnlyDependentFrontend((prev) => !prev);
  }

  function distributeResources() {
    const visibleTaskKeys = new Set(
      filteredTasks.map((task) => `${task.line}-${task.title}`)
    );

    const visibleTasks = tasks.filter((task) =>
      visibleTaskKeys.has(`${task.line}-${task.title}`)
    );

    setIsOptimizedMode(false);

    const backendBasesThatUnlockFrontend = new Set();
    const frontendBases = new Set(
      visibleTasks
        .filter((task) => (normalizeText(task.type) || detectTypeFromTitle(task.title)) === 'frontend')
        .map((task) => getDependencyKey(task.title))
    );

    visibleTasks.forEach((task) => {
      const normalizedType = normalizeText(task.type) || detectTypeFromTitle(task.title);
      if (normalizedType !== 'backend') return;
      const base = getDependencyKey(task.title);
      if (frontendBases.has(base)) {
        backendBasesThatUnlockFrontend.add(base);
      }
    });

    let depBackendIndex = 0;
    let otherBackendIndex = 0;
    let backendAssigned = 0;
    let frontendAssigned = 0;
    let automationAssigned = 0;
    let backendUnlockerAssigned = 0;
    let backendOtherAssigned = 0;
    let eligibleCount = 0;

    const BACKEND_TO_FRONTEND_PAIR = new Map([
      ['Augusto', 'Daniel'],
      ['Dieter', 'Pablo'],
    ]);
    const depBackendByBase = new Map();

    // First pass: assign backend devs to bases so frontend can look them up
    visibleTasks.forEach((task) => {
      const normalizedType = normalizeText(task.type) || detectTypeFromTitle(task.title);
      if (normalizedType !== 'backend') return;
      const baseKey = getDependencyKey(task.title);
      if (!backendBasesThatUnlockFrontend.has(baseKey)) return;
      if (!depBackendByBase.has(baseKey)) {
        const assigned = DEPENDENCY_BACKEND_DEVS[depBackendIndex % DEPENDENCY_BACKEND_DEVS.length];
        depBackendByBase.set(baseKey, assigned);
        depBackendIndex += 1;
      }
    });
    depBackendIndex = 0; // reset for actual assignment below

    setTasks((prevTasks) =>
      prevTasks.map((task) => {
        const taskKey = `${task.line}-${task.title}`;
        if (!visibleTaskKeys.has(taskKey)) {
          return task;
        }

        const normalizedBucket = normalizeText(
          task.bucket || task.status || task.progress
        );
        const normalizedType =
          normalizeText(task.type) || detectTypeFromTitle(task.title);

        if (!isConcludedTask(task) && isWaitingEnvironment(task)) {
          return task;
        }

        if (isAutomationTask(task.title) || isTestTask(task.title)) {
          eligibleCount += 1;
          automationAssigned += 1;
          return { ...task, resource: AUTOMATION_DEV };
        }

        if (!isTargetBucket(normalizedBucket)) {
          return task;
        }

        eligibleCount += 1;

        if (normalizedType === 'backend') {
          const baseKey = getDependencyKey(task.title);
          const isUnlockerTask = backendBasesThatUnlockFrontend.has(baseKey);

          let assigned = '';
          if (isUnlockerTask) {
            assigned = depBackendByBase.get(baseKey) ||
              DEPENDENCY_BACKEND_DEVS[depBackendIndex % DEPENDENCY_BACKEND_DEVS.length];
            depBackendIndex += 1;
            backendUnlockerAssigned += 1;
          } else {
            assigned = OTHER_BACKEND_DEVS[otherBackendIndex % OTHER_BACKEND_DEVS.length];
            otherBackendIndex += 1;
            backendOtherAssigned += 1;
          }

          backendAssigned += 1;
          return { ...task, resource: assigned };
        }

        if (normalizedType === 'frontend') {
          const baseKey = getDependencyKey(task.title);
          const backendDev = depBackendByBase.get(baseKey);
          const assigned = (backendDev && BACKEND_TO_FRONTEND_PAIR.get(backendDev))
            || 'Debora';
          frontendAssigned += 1;
          return { ...task, resource: assigned };
        }

        return task;
      })
    );

    if (backendAssigned === 0 && frontendAssigned === 0 && automationAssigned === 0) {
      setDistributionSummary(
        `Nenhuma tarefa distribuida. Elegiveis: ${eligibleCount}. Verifique se os titulos contem [Backend], [Frontend] ou [Automacao].`
      );
      return;
    }

    setDistributionSummary(
      `Distribuicao concluida: ${backendAssigned} backend (${backendUnlockerAssigned} com dependencia → Augusto/Dieter, ${backendOtherAssigned} demais → Rhaniery/Diego), ${frontendAssigned} frontend e ${automationAssigned} automacao (Ivan). Elegiveis: ${eligibleCount}.`
    );
  }

  function resetFiltersAndDistribution() {
    setSelectedStatuses([]);
    setSelectedTypes([]);
    setSelectedResources([]);
    setShowOnlyDependentFrontend(false);
    setOpenFilter(null);
    setDistributionSummary('');
    setIsOptimizedMode(false);
  }

  async function handleAFazerFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError('');
      const buffer = await file.arrayBuffer();
      const parsed = parseAFazerWorkbook(buffer);
      const newSource = { fileName: file.name, tasks: parsed.tasks };
      setAFazerSource(newSource);
      setTasks([...newSource.tasks, ...pendentesSource.tasks, ...concluidasSource.tasks]);
      resetFiltersAndDistribution();
    } catch (err) {
      setError('Nao foi possivel ler o arquivo "A Fazer". Confira se o arquivo e Excel valido.');
      console.error(err);
    }
  }

  async function handlePendentesFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError('');
      const buffer = await file.arrayBuffer();
      const parsed = parsePendentesWorkbook(buffer);
      const newSource = { fileName: file.name, tasks: parsed.tasks };
      setPendentesSource(newSource);
      setTasks([...aFazerSource.tasks, ...newSource.tasks, ...concluidasSource.tasks]);
      resetFiltersAndDistribution();
    } catch (err) {
      setError('Nao foi possivel ler o arquivo "Pendentes". Confira se o arquivo e Excel valido.');
      console.error(err);
    }
  }

  async function handleConcluidasFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError('');
      const buffer = await file.arrayBuffer();
      const parsed = parseConcluidasWorkbook(buffer);
      const newSource = { fileName: file.name, tasks: parsed.tasks };
      setConcluidasSource(newSource);
      setTasks([...aFazerSource.tasks, ...pendentesSource.tasks, ...newSource.tasks]);
      resetFiltersAndDistribution();
    } catch (err) {
      setError('Nao foi possivel ler o arquivo "Concluidas". Confira se o arquivo e Excel valido.');
      console.error(err);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <header className="hero">
          <p className="eyebrow">ProjectManager</p>
          <h1>Importar tarefas do sistema (Excel)</h1>
          <p>
            Envie os três arquivos .xlsx exportados: À Fazer, Pendentes e Concluídas.
          </p>
        </header>

        <div className="uploadGrid">
          <div className="uploadItem">
            <label className="upload">
              <span>📋 À Fazer</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleAFazerFileChange}
              />
            </label>
            {aFazerSource.fileName && (
              <p className="uploadMeta">{aFazerSource.fileName} ({aFazerSource.tasks.length} tarefas)</p>
            )}
          </div>

          <div className="uploadItem">
            <label className="upload">
              <span>⏳ Pendentes</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handlePendentesFileChange}
              />
            </label>
            {pendentesSource.fileName && (
              <p className="uploadMeta">{pendentesSource.fileName} ({pendentesSource.tasks.length} tarefas)</p>
            )}
          </div>

          <div className="uploadItem">
            <label className="upload">
              <span>✅ Concluídas</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleConcluidasFileChange}
              />
            </label>
            {concluidasSource.fileName && (
              <p className="uploadMeta">{concluidasSource.fileName} ({concluidasSource.tasks.length} tarefas)</p>
            )}
          </div>
        </div>

        {(aFazerSource.fileName || pendentesSource.fileName || concluidasSource.fileName) && (
          <button type="button" className="clearButton" onClick={clearAllSources}>
            🗑 Limpar arquivos
          </button>
        )}

        {error && <p className="error">{error}</p>}

        {!!tasks.length && (
          <div className="actionsRow">
            <button
              type="button"
              className="assignButton"
              onClick={distributeResources}
            >
              Distribuir Recursos Automaticamente
            </button>
            {distributionSummary && (
              <p className="distributionSummary">{distributionSummary}</p>
            )}
          </div>
        )}

        {!!tasks.length && progress && (
          <div className="progressSection">
            <div className="progressHeader">
              <span className="progressLabel">Progresso do projeto</span>
              <span className="progressPcts">
                <span className="progressDone">{progress.donePct}% concluído</span>
                <span className="progressSep">·</span>
                <span className="progressPending">{progress.pendPct}% restante</span>
              </span>
            </div>
            <div className="progressBarTrack">
              <div
                className="progressBarFill progressBarFill-done"
                style={{ width: `${progress.donePct}%` }}
                title={`Concluídas: ${progress.concluidas}`}
              />
              <div
                className="progressBarFill progressBarFill-pending"
                style={{ width: `${Math.round((progress.pendentes / progress.total) * 100)}%` }}
                title={`Pendentes: ${progress.pendentes}`}
              />
              <div
                className="progressBarFill progressBarFill-afazer"
                style={{ width: `${Math.round((progress.afazer / progress.total) * 100)}%` }}
                title={`A fazer: ${progress.afazer}`}
              />
            </div>
            <div className="progressLegend">
              <span className="progressLegendItem progressLegendItem-done">
                <span className="progressLegendDot" /> Concluídas: {progress.concluidas}
              </span>
              <span className="progressLegendItem progressLegendItem-pending">
                <span className="progressLegendDot" /> Pendentes: {progress.pendentes}
              </span>
              <span className="progressLegendItem progressLegendItem-afazer">
                <span className="progressLegendDot" /> A fazer: {progress.afazer}
              </span>
              <span className="progressLegendItem progressLegendItem-total">
                Total: {progress.total}
              </span>
            </div>
          </div>
        )}

        {!!tasks.length && (
          <>
            <div className="tabsContainer">
              <button
                type="button"
                className={`tabButton ${activeTab === 'tasks' ? 'active' : ''}`}
                onClick={() => setActiveTab('tasks')}
              >
                📋 Tarefas
              </button>
              <button
                type="button"
                className={`tabButton ${activeTab === 'gantt' ? 'active' : ''}`}
                onClick={() => setActiveTab('gantt')}
              >
                📊 Cronograma Gantt
              </button>
            </div>

            {activeTab === 'tasks' && (
              <>
                <div className="filtersContainer">
                  <div className="filterAccordion">
                    <section className="filterItem">
                      <button
                        type="button"
                        className="filterHeader"
                        onClick={() => toggleOpenFilter('status')}
                        aria-expanded={openFilter === 'status'}
                      >
                        <span>Status</span>
                        {selectedStatuses.length > 0 && (
                          <span className="filterCount">{selectedStatuses.length}</span>
                        )}
                      </button>
                      {openFilter === 'status' && (
                        <div className="filterBody">
                          <div className="filterOptions">
                            {uniqueStatuses.map((status) => (
                              <label key={status} className="filterCheck">
                                <input
                                  type="checkbox"
                                  checked={selectedStatuses.includes(status)}
                                  onChange={() => toggleStatusFilter(status)}
                                />
                                <span>{status || '(vazio)'}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="filterItem">
                      <button
                        type="button"
                        className="filterHeader"
                        onClick={() => toggleOpenFilter('type')}
                        aria-expanded={openFilter === 'type'}
                      >
                        <span>Tipo</span>
                        {selectedTypes.length > 0 && (
                          <span className="filterCount">{selectedTypes.length}</span>
                        )}
                      </button>
                      {openFilter === 'type' && (
                        <div className="filterBody">
                          <div className="filterOptions">
                            {uniqueTypes.map((type) => (
                              <label key={type} className="filterCheck">
                                <input
                                  type="checkbox"
                                  checked={selectedTypes.includes(type)}
                                  onChange={() => toggleTypeFilter(type)}
                                />
                                <span>{type}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="filterItem">
                      <button
                        type="button"
                        className="filterHeader"
                        onClick={() => toggleOpenFilter('resource')}
                        aria-expanded={openFilter === 'resource'}
                      >
                        <span>Recurso</span>
                        {selectedResources.length > 0 && (
                          <span className="filterCount">{selectedResources.length}</span>
                        )}
                      </button>
                      {openFilter === 'resource' && (
                        <div className="filterBody">
                          <div className="filterOptions">
                            {uniqueResources.map((resource) => (
                              <label key={resource} className="filterCheck">
                                <input
                                  type="checkbox"
                                  checked={selectedResources.includes(resource)}
                                  onChange={() => toggleResourceFilter(resource)}
                                />
                                <span title={resource}>{getShortName(resource)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="filterItem">
                      <button
                        type="button"
                        className="filterHeader"
                        onClick={() => toggleOpenFilter('dependency')}
                        aria-expanded={openFilter === 'dependency'}
                      >
                        <span>Dependência</span>
                        {showOnlyDependentFrontend && (
                          <span className="filterCount">1</span>
                        )}
                      </button>
                      {openFilter === 'dependency' && (
                        <div className="filterBody">
                          <div className="filterOptions">
                            <label className="filterCheck">
                              <input
                                type="checkbox"
                                checked={showOnlyDependentFrontend}
                                onChange={toggleDependentFrontendFilter}
                              />
                              <span>Somente Frontend dependente de Backend</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
                <div className="stats">
                  <article className="statsTotal">
                    <span>Total</span>
                    <strong>{stats.total}</strong>
                  </article>
                  <article className="statsHighlight">
                    <span>Pendencias validas</span>
                    <strong>{stats.trackedPending}</strong>
                  </article>
                  <article className="statsWithId">
                    <span>Com ID</span>
                    <strong>{stats.withId}</strong>
                  </article>
                  <article className="statsWithoutId">
                    <span>Sem ID</span>
                    <strong>{stats.withoutId}</strong>
                  </article>
                </div>

                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Titulo</th>
                        <th>Bucket</th>
                        <th>Status</th>
                        <th>Recurso</th>
                        <th>Prazo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr key={`${task.line}-${task.title}`}>
                          <td>{task.id ?? '-'}</td>
                          <td>{task.title}</td>
                          <td>{task.bucket || '-'}</td>
                          <td>{task.status || '-'}</td>
                          <td>{task.resource || '-'}</td>
                          <td>{task.dueDate || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeTab === 'gantt' && (
              <GanttChart
                tasks={filteredTasks}
                onResourceChange={handleGanttResourceChange}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default App;

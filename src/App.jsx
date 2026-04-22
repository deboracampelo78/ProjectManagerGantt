import { useMemo, useState } from 'react';
import { parsePlannerWorkbook } from './utils/plannerParser';
import GanttChart from './components/GanttChart';

const BACKEND_DEVS = ['Augusto', 'Anderson', 'Rhaniery', 'Dieter'];
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

  if (normalized === 'tarefas pendentes' || normalized === 'a fazer') {
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

function isConcludedTask(task) {
  const progressOrStatus = normalizeText(task.progress || task.status);
  return progressOrStatus.startsWith('concluid');
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

  if (normalized === 'tarefas pendentes' || normalized === 'a fazer') {
    return true;
  }

  return normalized === 'paginas de configuracoes';
}

function isNotStartedProgress(task) {
  const normalized = normalizeText(task.progress || task.status);
  return normalized.startsWith('nao inici');
}

function isTrackedPendingTask(task) {
  return isNotConcludedBucket(task.bucket) && isNotStartedProgress(task);
}

function isConfigPagesBucket(bucketValue) {
  return normalizeText(bucketValue) === 'paginas de configuracoes';
}

function App() {
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [headers, setHeaders] = useState([]);
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedResources, setSelectedResources] = useState([]);
  const [showOnlyDependentFrontend, setShowOnlyDependentFrontend] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [distributionSummary, setDistributionSummary] = useState('');
  const [activeTab, setActiveTab] = useState('tasks');

  function toggleOpenFilter(filterKey) {
    setOpenFilter((prev) => (prev === filterKey ? null : filterKey));
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

        return matchesExplicitStatus || matchesNotConcluded;
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

    // Strategy:
    // - 3 backend devs focus on "Paginas de Configuracoes"
    // - 1 backend dev is reserved for backend tasks that unblock frontend.
    const CONFIG_FOCUS_BACKEND_DEVS = BACKEND_DEVS.slice(0, 3);
    const UNLOCKER_BACKEND_DEV = BACKEND_DEVS[3] || BACKEND_DEVS[0];

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

    let backendIndex = 0;
    let configBackendIndex = 0;
    let frontendIndex = 0;
    let backendAssigned = 0;
    let frontendAssigned = 0;
    let automationAssigned = 0;
    let backendUnlockerAssigned = 0;
    let configFocusedAssigned = 0;
    let eligibleCount = 0;

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

        if (isAutomationTask(task.title)) {
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
          const isConfigTask = isConfigPagesBucket(task.bucket);

          let assigned = '';
          if (isUnlockerTask) {
            assigned = UNLOCKER_BACKEND_DEV;
            backendUnlockerAssigned += 1;
          } else if (isConfigTask && CONFIG_FOCUS_BACKEND_DEVS.length > 0) {
            assigned =
              CONFIG_FOCUS_BACKEND_DEVS[
                configBackendIndex % CONFIG_FOCUS_BACKEND_DEVS.length
              ];
            configBackendIndex += 1;
            configFocusedAssigned += 1;
          } else {
            const fallbackPool =
              CONFIG_FOCUS_BACKEND_DEVS.length > 0
                ? CONFIG_FOCUS_BACKEND_DEVS
                : BACKEND_DEVS;
            assigned = fallbackPool[backendIndex % fallbackPool.length];
            backendIndex += 1;
          }

          backendAssigned += 1;
          return { ...task, resource: assigned };
        }

        if (normalizedType === 'frontend') {
          const assigned = FRONTEND_DEVS[frontendIndex % FRONTEND_DEVS.length];
          frontendIndex += 1;
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
      `Distribuicao concluida: ${backendAssigned} backend (${backendUnlockerAssigned} desbloqueio front, ${configFocusedAssigned} paginas de configuracoes), ${frontendAssigned} frontend e ${automationAssigned} automacao (Ivan). Elegiveis: ${eligibleCount}.`
    );
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setError('');
      setFileName(file.name);

      const buffer = await file.arrayBuffer();
      const parsed = parsePlannerWorkbook(buffer);

      setSheetName(parsed.sheetName || '');
      setTasks(parsed.tasks);
      setHeaders(parsed.headers || []);
      setSelectedStatuses([]);
      setSelectedTypes([]);
      setSelectedResources([]);
      setShowOnlyDependentFrontend(false);
      setOpenFilter(null);
      setDistributionSummary('');
    } catch (err) {
      setTasks([]);
      setSheetName('');
      setHeaders([]);
      setError('Nao foi possivel ler a planilha. Confira se o arquivo e Excel valido.');
      console.error(err);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <header className="hero">
          <p className="eyebrow">ProjectManager</p>
          <h1>Importar Kanban do Planner (Excel)</h1>
          <p>
            Envie seu arquivo .xlsx exportado do Planner. O ID da tarefa sera extraido
            automaticamente do numero presente no titulo.
          </p>
        </header>

        <label className="upload">
          <span>Selecionar planilha</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
          />
        </label>

        {error && <p className="error">{error}</p>}

        {headers.length > 0 && (
          <div className="debugHeaders">
            <details>
              <summary>📋 Colunas detectadas ({headers.length})</summary>
              <ul>
                {headers.map((header, idx) => (
                  <li key={idx}>{header}</li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {fileName && (
          <div className="meta">
            <p>
              <strong>Arquivo:</strong> {fileName}
            </p>
            <p>
              <strong>Aba:</strong> {sheetName || 'Nao identificada'}
            </p>
          </div>
        )}

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
              <GanttChart tasks={filteredTasks} />
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default App;

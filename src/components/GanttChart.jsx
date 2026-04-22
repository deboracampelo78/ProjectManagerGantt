import React, { useMemo, useRef, useState, useEffect } from 'react';
import '../styles/GanttChart.css';

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

// National holidays used by the business-day calendar.
const HOLIDAYS = new Set([
  '2026-01-01', // Confraternizacao Universal
  '2026-02-16', // Carnaval (optional)
  '2026-02-17', // Carnaval (optional)
  '2026-04-03', // Sexta-feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi (optional)
  '2026-09-07', // Independencia
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamacao da Republica
  '2026-11-20', // Dia da Consciencia Negra
  '2026-12-25', // Natal
]);

const DEPENDENCY_PAIR_COLORS = [
  '#FF5252',
  '#29B6F6',
  '#66BB6A',
  '#AB47BC',
  '#FFA726',
  '#26A69A',
  '#5C6BC0',
  '#EC407A',
  '#8D6E63',
  '#7CB342',
];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(date) {
  const d = startOfDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeekend(date) {
  const day = startOfDay(date).getDay();
  return day === 0 || day === 6;
}

function isHoliday(date) {
  return HOLIDAYS.has(toISODate(date));
}

function isBusinessDay(date) {
  return !isWeekend(date) && !isHoliday(date);
}

function nextBusinessDay(date) {
  const d = startOfDay(date);
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function nextBusinessDayAfter(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return nextBusinessDay(d);
}

function addBusinessDays(date, daysToAdd) {
  const d = nextBusinessDay(date);
  let remaining = Math.max(daysToAdd, 0);

  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) {
      remaining -= 1;
    }
  }

  return d;
}

function countBusinessDaysBetween(startDate, endDate) {
  let from = startOfDay(startDate);
  let to = startOfDay(endDate);

  if (from.getTime() === to.getTime()) {
    return 0;
  }

  let sign = 1;
  if (from > to) {
    sign = -1;
    const temp = from;
    from = to;
    to = temp;
  }

  const cursor = new Date(from);
  let count = 0;
  while (cursor < to) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor)) {
      count += 1;
    }
  }

  return count * sign;
}

function buildBusinessTimeline(startDate, totalDays) {
  const timeline = [];
  const cursor = nextBusinessDay(startDate);

  while (timeline.length < totalDays) {
    if (isBusinessDay(cursor)) {
      timeline.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return timeline;
}

function getTaskBaseName(title) {
  return title.replace(/\[(backend|frontend|automac[aã]o|testes?\s*front-?end)\]/gi, '').trim();
}

function getDependencyKey(title) {
  const rawTitle = String(title || '');
  const afterTagMatch = rawTitle.match(
    /\[(backend|frontend|automac[aã]o|testes?\s*front-?end)\]\s*-\s*(.+)$/i
  );

  const candidate = afterTagMatch ? afterTagMatch[2] : getTaskBaseName(rawTitle);

  return normalizeText(
    candidate
      .replace(/^[a-z]+\s*-\s*\d+\s*-\s*/i, '')
      .replace(/^\d+\s*-\s*/i, '')
  );
}

function getFirstName(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(' ')[0];
}

function getInitials(fullName) {
  if (!fullName) return '';
  const firstName = getFirstName(fullName);
  return firstName
    .substring(0, 2)
    .toUpperCase();
}

function getTaskKey(task) {
  return `${task.line}-${task.title}`;
}

function getTaskNumberLabel(task) {
  if (task.taskNumber !== null && task.taskNumber !== undefined && String(task.taskNumber).trim() !== '') {
    return String(task.taskNumber);
  }

  const match = String(task.title || '').match(/\d+/);
  return match ? match[0] : '--';
}

function getTaskType(title) {
  const match = String(title || '').match(
    /\[(frontend|backend|automac[aã]o|testes?\s*front-?end)\]/i
  );
  if (!match) return '';
  const normalized = normalizeText(match[1]);
  return normalized === 'backend' ? 'backend' : 'frontend';
}

function getTaskDurationByType(taskType) {
  return taskType === 'backend' ? 3 : 2;
}

function calculateGanttSchedule(tasks) {
  const BACKEND_DURATION = 3;
  const FRONTEND_DURATION = 2;
  const PROJECT_START = nextBusinessDay(new Date(2026, 3, 21)); // 21/04/2026 (month is 0-indexed)
  
  // Build a map of task pairs (Backend -> Frontend with same base name)
  const tasksByBaseName = {};
  const taskMap = new Map();

  tasks.forEach((task) => {
    taskMap.set(task, {
      ...task,
      baseName: getDependencyKey(task.title),
      type: getTaskType(task.title),
    });
  });

  // Group by base name to find Backend/Frontend pairs
  Array.from(taskMap.values()).forEach((taskInfo) => {
    if (!tasksByBaseName[taskInfo.baseName]) {
      tasksByBaseName[taskInfo.baseName] = [];
    }
    tasksByBaseName[taskInfo.baseName].push(taskInfo);
  });

  // Build dependency graph
  const dependencies = new Map();
  const dependents = new Map();
  const inDegree = new Map();
  const allTasksInSchedule = new Set();

  Array.from(taskMap.values()).forEach((taskInfo) => {
    allTasksInSchedule.add(taskInfo);
    inDegree.set(taskInfo, 0);
    dependencies.set(taskInfo, new Set());
    dependents.set(taskInfo, new Set());
  });

  // Add Frontend -> Backend dependencies (same base name)
  Array.from(taskMap.values()).forEach((taskInfo) => {
    if (taskInfo.type === 'frontend') {
      // Find Backend with same base name
      const backendTask = Array.from(taskMap.values()).find(
        (t) => t.baseName === taskInfo.baseName && t.type === 'backend'
      );
      if (backendTask) {
        dependencies.get(taskInfo).add(backendTask);
        dependents.get(backendTask).add(taskInfo);
        inDegree.set(taskInfo, (inDegree.get(taskInfo) || 0) + 1);
      }
    }
  });

  // Heuristic: compute downstream criticality to prioritize tasks that unlock more work.
  const criticalityMemo = new Map();
  const computeCriticality = (task) => {
    if (criticalityMemo.has(task)) {
      return criticalityMemo.get(task);
    }

    const ownDuration = getTaskDurationByType(task.type);
    const downstream = Array.from(dependents.get(task) || []);
    if (downstream.length === 0) {
      criticalityMemo.set(task, ownDuration);
      return ownDuration;
    }

    let maxDownstream = 0;
    downstream.forEach((nextTask) => {
      const candidate = computeCriticality(nextTask);
      if (candidate > maxDownstream) {
        maxDownstream = candidate;
      }
    });

    const score = ownDuration + maxDownstream;
    criticalityMemo.set(task, score);
    return score;
  };

  Array.from(allTasksInSchedule).forEach((task) => {
    computeCriticality(task);
  });

  // Topological sort considering both task dependencies and resource constraints
  const schedule = new Map();
  const resourceSchedule = new Map(); // Track when each resource finishes
  const processed = new Set();

  // Process tasks in topological order
  let iteration = 0;
  while (processed.size < allTasksInSchedule.size && iteration < 1000) {
    iteration++;
    
    // Find tasks with no unprocessed dependencies
    const availableTasks = Array.from(allTasksInSchedule).filter(
      (task) =>
        !processed.has(task) &&
        Array.from(dependencies.get(task)).every((dep) => processed.has(dep))
    );

    if (availableTasks.length === 0) {
      // Shouldn't happen with valid input
      break;
    }

    // Sort available tasks by resource to assign them in order
    availableTasks.sort((a, b) => {
      const resourceA = (a.resource || '').toLowerCase();
      const resourceB = (b.resource || '').toLowerCase();
      const resourceCompare = resourceA.localeCompare(resourceB);
      if (resourceCompare !== 0) return resourceCompare;

      const criticalityA = criticalityMemo.get(a) || 0;
      const criticalityB = criticalityMemo.get(b) || 0;
      if (criticalityA !== criticalityB) return criticalityB - criticalityA;

      if (a.type !== b.type) {
        return a.type === 'backend' ? -1 : 1;
      }

      return String(a.baseName || '').localeCompare(String(b.baseName || ''));
    });

    for (const task of availableTasks) {
      // Calculate earliest start date
      let startDate = new Date(PROJECT_START);

      // Check dependencies (Frontend waits for Backend to finish)
      const taskDeps = dependencies.get(task);
      for (const dep of taskDeps) {
        const depSchedule = schedule.get(dep);
        const depEndDate = nextBusinessDayAfter(depSchedule.endDate); // Start next business day after dependency ends
        if (depEndDate > startDate) {
          startDate = new Date(depEndDate);
        }
      }

      // Check resource availability
      const resource = task.resource || 'Unassigned';
      if (!resourceSchedule[resource]) {
        resourceSchedule[resource] = new Date(PROJECT_START);
      }

      const resourceAvailableDate = nextBusinessDay(resourceSchedule[resource]);
      if (resourceAvailableDate > startDate) {
        startDate = new Date(resourceAvailableDate);
      }

      startDate = nextBusinessDay(startDate);

      const taskDuration = getTaskDurationByType(task.type);

      // Calculate end date
      const endDate = addBusinessDays(startDate, taskDuration - 1);

      // Update resource schedule
      resourceSchedule[resource] = nextBusinessDayAfter(endDate);

      schedule.set(task, {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        duration: taskDuration,
        daysFromStart: countBusinessDaysBetween(PROJECT_START, startDate),
      });

      processed.add(task);
    }
  }

  // Calculate project end date
  let projectEndDate = new Date(PROJECT_START);
  Array.from(schedule.values()).forEach((taskSchedule) => {
    if (taskSchedule.endDate > projectEndDate) {
      projectEndDate = new Date(taskSchedule.endDate);
    }
  });

  const projectDeadline = new Date(2026, 5, 30); // 30/06/2026
  const daysToDeadline = countBusinessDaysBetween(projectEndDate, projectDeadline);

  return {
    schedule,
    tasksByBaseName,
    projectStartDate: PROJECT_START,
    projectEndDate,
    projectDeadline,
    daysToDeadline,
    backendDuration: BACKEND_DURATION,
    frontendDuration: FRONTEND_DURATION,
  };
}

function formatDate(date) {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function buildDependencyData(schedule) {
  const groupedByBase = new Map();

  Array.from(schedule.entries()).forEach(([task, taskSchedule]) => {
    const type = getTaskType(task.title);
    if (type !== 'backend' && type !== 'frontend') return;

    const baseName = getDependencyKey(task.title);
    const taskId = getTaskKey(task);

    if (!groupedByBase.has(baseName)) {
      groupedByBase.set(baseName, { backend: [], frontend: [] });
    }

    groupedByBase.get(baseName)[type].push({
      id: taskId,
      startDate: taskSchedule.startDate,
    });
  });

  const pairs = [];
  const dependencyTaskIds = new Set();
  const dependencyColorByTaskId = new Map();

  groupedByBase.forEach((group) => {
    group.backend.sort((a, b) => a.startDate - b.startDate);
    group.frontend.sort((a, b) => a.startDate - b.startDate);

    const pairCount = Math.min(group.backend.length, group.frontend.length);
    for (let i = 0; i < pairCount; i++) {
      const backendId = group.backend[i].id;
      const frontendId = group.frontend[i].id;
      const pairColor = DEPENDENCY_PAIR_COLORS[pairs.length % DEPENDENCY_PAIR_COLORS.length];

      pairs.push({
        id: `${backendId}->${frontendId}`,
        backendId,
        frontendId,
        color: pairColor,
      });

      dependencyTaskIds.add(backendId);
      dependencyTaskIds.add(frontendId);
      dependencyColorByTaskId.set(backendId, pairColor);
      dependencyColorByTaskId.set(frontendId, pairColor);
    }
  });

  return { pairs, dependencyTaskIds, dependencyColorByTaskId };
}

function GanttChart({ tasks }) {
  const ganttData = useMemo(() => {
    if (!tasks || tasks.length === 0) return null;
    return calculateGanttSchedule(tasks);
  }, [tasks]);

  const taskRefsMap = useRef({});
  const svgRef = useRef(null);
  const [connections, setConnections] = useState([]);

  const dependencyData = useMemo(() => {
    if (!ganttData) {
      return { pairs: [], dependencyTaskIds: new Set(), dependencyColorByTaskId: new Map() };
    }
    return buildDependencyData(ganttData.schedule);
  }, [ganttData]);

  // Update connections when tasks layout changes
  useEffect(() => {
    if (!ganttData || dependencyData.pairs.length === 0) {
      setConnections([]);
      return;
    }

    const recalculateConnections = () => {
      const newConnections = [];
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;

      dependencyData.pairs.forEach((pair) => {
        const backendEl = taskRefsMap.current[pair.backendId];
        const frontendEl = taskRefsMap.current[pair.frontendId];

        if (!backendEl || !frontendEl) return;

        const backendRect = backendEl.getBoundingClientRect();
        const frontendRect = frontendEl.getBoundingClientRect();

        const x1 = backendRect.right - svgRect.left;
        const y1 = backendRect.top - svgRect.top + backendRect.height / 2;
        const x2 = frontendRect.left - svgRect.left;
        const y2 = frontendRect.top - svgRect.top + frontendRect.height / 2;

        newConnections.push({ x1, y1, x2, y2, id: pair.id, color: pair.color });
      });

      setConnections(newConnections);
    };

    // Recalculate after refs settle in the DOM.
    let rafA = 0;
    let rafB = 0;
    const scheduleRecalculate = () => {
      rafA = requestAnimationFrame(() => {
        rafB = requestAnimationFrame(recalculateConnections);
      });
    };

    scheduleRecalculate();
    
    // Also recalculate on window resize
    const handleResize = () => scheduleRecalculate();
    window.addEventListener('resize', handleResize);
    
    // Use MutationObserver to detect layout changes
    const observer = new MutationObserver(scheduleRecalculate);
    if (svgRef.current?.parentElement) {
      observer.observe(svgRef.current.parentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }

    return () => {
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [ganttData, dependencyData]);

  if (!ganttData) {
    return <div className="ganttEmpty">Nenhuma tarefa para exibir no Gantt</div>;
  }

  const {
    schedule,
    projectStartDate,
    projectEndDate,
    projectDeadline,
    daysToDeadline,
    backendDuration,
    frontendDuration,
  } = ganttData;

  // Group tasks by resource (one row per resource)
  const tasksByResource = {};
  Array.from(schedule.entries()).forEach(([originalTask, taskSchedule]) => {
    const resource = originalTask.resource || 'Unassigned';
    const firstName = getFirstName(resource);

    if (!tasksByResource[firstName]) {
      tasksByResource[firstName] = [];
    }

    tasksByResource[firstName].push({
      ...originalTask,
      resource: firstName,
      ...taskSchedule,
      taskKey: getTaskKey(originalTask),
      taskNumber: originalTask.id,
    });
  });

  const preferredResourceOrder = [
    'Andersom',
    'Anderson',
    'Augusto',
    'Rhaniery',
    'Dieter',
    'Pablo',
    'Daniel',
  ];

  const sortedResources = Object.keys(tasksByResource).sort((a, b) => {
    const preferredIndexA = preferredResourceOrder.indexOf(a);
    const preferredIndexB = preferredResourceOrder.indexOf(b);

    if (preferredIndexA !== -1 && preferredIndexB !== -1) {
      return preferredIndexA - preferredIndexB;
    }

    if (preferredIndexA !== -1) return -1;
    if (preferredIndexB !== -1) return 1;

    const aTasks = tasksByResource[a];
    const bTasks = tasksByResource[b];

    const countByType = (items, type) => items.filter((t) => getTaskType(t.title) === type).length;
    const classify = (items) => {
      const backendCount = countByType(items, 'backend');
      const frontendCount = countByType(items, 'frontend');
      const automationCount = items.filter((t) => /\[\s*automac[aã]o\s*\]/i.test(String(t.title || ''))).length;

      if (automationCount > 0 && backendCount === 0 && frontendCount === 0) return 2;
      if (backendCount > 0 && frontendCount === 0) return 0;
      if (frontendCount > 0 && backendCount === 0) return 1;
      if (backendCount > frontendCount) return 0;
      if (frontendCount > backendCount) return 1;
      return 3;
    };

    const rankA = classify(aTasks);
    const rankB = classify(bTasks);
    if (rankA !== rankB) return rankA - rankB;

    const firstDayA = Math.min(...aTasks.map((t) => t.daysFromStart));
    const firstDayB = Math.min(...bTasks.map((t) => t.daysFromStart));
    if (firstDayA !== firstDayB) return firstDayA - firstDayB;

    return a.localeCompare(b);
  });

  sortedResources.forEach((resource) => {
    tasksByResource[resource].sort((a, b) => a.daysFromStart - b.daysFromStart);
  });

  // Calculate business-day timeline for the chart header/grid.
  const totalBusinessDays = Math.max(
    countBusinessDaysBetween(projectStartDate, nextBusinessDayAfter(projectEndDate)) + 5,
    70
  );
  const timelineDates = buildBusinessTimeline(projectStartDate, totalBusinessDays);
  const daysInGrid = timelineDates.length;
  const RESOURCE_COLUMN_WIDTH = 200;
  const DAY_COLUMN_MIN_WIDTH = 34;
  const timelineMinWidth = RESOURCE_COLUMN_WIDTH + daysInGrid * DAY_COLUMN_MIN_WIDTH;

  const monthSegments = [];
  let currentMonthKey = '';
  let segmentStart = 0;

  timelineDates.forEach((date, index) => {
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (monthKey !== currentMonthKey) {
      if (currentMonthKey) {
        monthSegments.push({
          start: segmentStart,
          span: index - segmentStart,
          label: timelineDates[segmentStart].toLocaleDateString('pt-BR', {
            month: 'short',
          }),
        });
      }
      currentMonthKey = monthKey;
      segmentStart = index;
    }
  });

  if (timelineDates.length > 0) {
    monthSegments.push({
      start: segmentStart,
      span: timelineDates.length - segmentStart,
      label: timelineDates[segmentStart].toLocaleDateString('pt-BR', {
        month: 'short',
      }),
    });
  }

  return (
    <div className="ganttContainer">
      <div className="ganttHeader">
        <h2>Cronograma de Tarefas (Gantt)</h2>
        <div className="ganttProjectInfo">
          <p>
            <strong>Início do Projeto:</strong> {formatDate(projectStartDate)}
          </p>
          <p>
            <strong>Término Estimado:</strong> {formatDate(projectEndDate)}
          </p>
          <p>
            <strong>Prazo Final:</strong> {formatDate(projectDeadline)}
          </p>
          <p className={daysToDeadline >= 0 ? 'onTrack' : 'atRisk'}>
            <strong>{daysToDeadline >= 0 ? '✓ No prazo' : '✗ Acima do prazo'}:</strong>{' '}
            {Math.abs(daysToDeadline)} dias {daysToDeadline >= 0 ? 'antes' : 'após'} do prazo
          </p>
        </div>
      </div>

      <div className="ganttChartWrapper">
        <div className="ganttCalendarHeader" style={{ minWidth: `${timelineMinWidth}px` }}>
          <div className="ganttHeaderSpacer"></div>
          <div className="ganttCalendarBody">
            <div
              className="ganttCalendarMonths"
              style={{
                gridTemplateColumns: `repeat(${daysInGrid}, minmax(34px, 1fr))`,
              }}
            >
              {monthSegments.map((segment, index) => (
                <div
                  key={`month-${index}`}
                  className="ganttCalendarMonth"
                  style={{
                    gridColumn: `${segment.start + 1} / span ${segment.span}`,
                  }}
                >
                  {segment.label}
                </div>
              ))}
            </div>
            <div
              className="ganttCalendarDays"
              style={{
                gridTemplateColumns: `repeat(${daysInGrid}, minmax(34px, 1fr))`,
              }}
            >
              {timelineDates.map((currentDate, i) => (
                <div
                  key={`calendar-day-${i}`}
                  className={`ganttCalendarDay ${currentDate.getMonth() === 5 ? 'deadlineMonth' : ''}`}
                >
                  {currentDate.getDate()}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="ganttTimeline" style={{ minWidth: `${timelineMinWidth}px` }}>
          <div className="ganttLegend">
            <div className="ganttLegendItem">
              <span className="taskBarBackend"></span>
              <span>Backend</span>
            </div>
            <div className="ganttLegendItem">
              <span className="taskBarFrontend"></span>
              <span>Frontend</span>
            </div>
            <div className="ganttLegendItem">
              <span className="taskBarAutomation"></span>
              <span>Automação</span>
            </div>
            <div className="ganttLegendItem">
              <span className="taskBarDependency"></span>
              <span>Com Dependência</span>
            </div>
            <div className="ganttLegendItem">
              <svg width="20" height="20" style={{ overflow: 'visible' }}>
                <path d="M 2 10 Q 10 10, 18 10" stroke="#FF1744" strokeWidth="3" fill="none" strokeDasharray="8,4" />
              </svg>
              <span>Vinculação Backend→Frontend</span>
            </div>
          </div>

          {sortedResources.map((resource) => (
            <div key={resource} className="ganttRow">
              <div className="ganttResourceName">{resource}</div>
              <div
                className="ganttBarContainer"
                style={{
                  gridTemplateColumns: `repeat(${daysInGrid}, minmax(34px, 1fr))`,
                }}
              >
                {/* Grid background */}
                {timelineDates.map((currentDate, i) => {
                  const isDeadlineMonth = currentDate.getMonth() === 5; // June

                  return (
                    <div
                      key={`bg-${i}`}
                      className={`ganttGridCell ${isDeadlineMonth ? 'deadlineMonth' : ''}`}
                    />
                  );
                })}

                {/* Task bars */}
                {tasksByResource[resource].map((task) => {
                  const type = getTaskType(task.title);
                  const isAutomation = task.resource === 'Ivan';
                  const taskNumberLabel = getTaskNumberLabel(task);
                  const hasDependency = dependencyData.dependencyTaskIds.has(task.taskKey);
                  const dependencyColor = dependencyData.dependencyColorByTaskId.get(task.taskKey);
                  const taskName = getTaskBaseName(task.title);
                  const tooltipText = taskName;

                  return (
                    <div
                      ref={(el) => {
                        if (el) {
                          taskRefsMap.current[task.taskKey] = el;
                        }
                      }}
                      key={task.taskKey}
                      className={`ganttTask ganttTask-${type}${isAutomation ? ' ganttTask-automation' : ''}${hasDependency ? ' ganttTask-withDependency' : ''}`}
                      style={{
                        gridColumn: `${task.daysFromStart + 1} / span ${task.duration}`,
                        ...(hasDependency && dependencyColor
                          ? { '--dependency-color': dependencyColor }
                          : {}),
                      }}
                      title={tooltipText}
                      data-task-name={taskName}
                    >
                      <span className="ganttTaskLabel">{taskNumberLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

        {/* Dependencies connector overlay */}
        <svg
          ref={svgRef}
          className="ganttConnectionsOverlay"
        >
          {connections.map((conn) => (
            <g key={conn.id}>
              {/* Curved connector line */}
              <path
                d={`M ${conn.x1} ${conn.y1} Q ${(conn.x1 + conn.x2) / 2} ${conn.y1}, ${conn.x2} ${conn.y2}`}
                stroke={conn.color || '#FF1744'}
                strokeWidth="3"
                fill="none"
                strokeDasharray="8,4"
                opacity="0.95"
              />
              {/* Arrow head */}
              <polygon
                points={`${conn.x2},${conn.y2} ${conn.x2 - 9},${conn.y2 - 6} ${conn.x2 - 9},${conn.y2 + 6}`}
                fill={conn.color || '#FF1744'}
                opacity="0.95"
              />
            </g>
          ))}
        </svg>
        </div>
      </div>

      <div className="ganttFooter">
        <p>
          <strong>Cronograma por Recurso:</strong> Duracao por tipo: Backend {backendDuration} dias uteis,
          Frontend/Automacao {frontendDuration} dias uteis.
          A sequencia respeita: (1) Frontend aguarda Backend do mesmo nome, (2) um desenvolvedor executa uma tarefa por vez,
          (3) finais de semana e feriados sao ignorados no calculo.
          Barras e conexoes com <strong>cores iguais por par</strong> indicam dependencias entre Backend e Frontend.
        </p>
      </div>
    </div>
  );
}

export default GanttChart;

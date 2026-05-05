import * as XLSX from 'xlsx';

const HEADER_ALIASES = {
  title: [
    'nome da tarefa',
    'tarefa',
    'nome da tarefa',
    'task name',
    'titulo',
    'title',
    'nome',
  ],
  status: ['status', 'progresso', 'progress', 'etapa'],
  progress: ['progresso', 'progress', 'status'],
  bucket: ['nome do bucket', 'bucket', 'coluna', 'fase'],
  resource: [
    'recurso',
    'responsavel',
    'assigned to',
    'atribuido',
    'atribuido a',
    'atribuído a',
    'owner',
  ],
  dueDate: ['data de entrega', 'deadline', 'due date', 'vencimento', 'prazo'],
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectHeaderMap(headers) {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header),
  }));

  const map = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    // First try exact match
    let found = normalizedHeaders.find((header) =>
      aliases.includes(header.normalized)
    );

    // If not found, try partial match
    if (!found) {
      found = normalizedHeaders.find((header) =>
        aliases.some(
          (alias) =>
            header.normalized.includes(alias) ||
            alias.includes(header.normalized)
        )
      );
    }

    if (found) {
      map[field] = found.original;
    }
  }

  // Extra fallback for title: look for any column with "nome" in it
  if (!map.title) {
    const likelyTitle = normalizedHeaders.find(
      (h) =>
        h.normalized.includes('nome') &&
        !h.normalized.includes('identificacao')
    );
    if (likelyTitle) {
      map.title = likelyTitle.original;
    } else if (headers[0]) {
      map.title = headers[0];
    }
  }

  return map;
}

export function extractTaskIdFromTitle(title) {
  const rawTitle = String(title || '');
  const match = rawTitle.match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function extractTaskTypeFromTitle(title) {
  const rawTitle = String(title || '');
  const match = rawTitle.match(
    /\[(frontend|backend|automac[aã]o|testes?\s*front-?end)\]/i
  );

  if (!match) {
    return null;
  }

  const normalized = match[1].toLowerCase();
  if (normalized === 'backend') {
    return 'Backend';
  }

  return 'Frontend';
}

export function parsePlannerWorkbook(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return {
      sheetName: null,
      tasks: [],
    };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
  });

  if (!rows.length) {
    return {
      sheetName: firstSheetName,
      tasks: [],
    };
  }

  const headers = Object.keys(rows[0]);
  const headerMap = detectHeaderMap(headers);

  const tasks = rows
    .map((row, index) => {
      const title = row[headerMap.title] ?? '';
      const progress = headerMap.progress ? row[headerMap.progress] : '';
      const bucket = headerMap.bucket ? row[headerMap.bucket] : '';
      const status = headerMap.status
        ? row[headerMap.status]
        : progress || bucket || '';
      const resource = headerMap.resource ? row[headerMap.resource] : '';
      const dueDate = headerMap.dueDate ? row[headerMap.dueDate] : '';

      return {
        line: index + 2,
        id: extractTaskIdFromTitle(title),
        type: extractTaskTypeFromTitle(title),
        title: String(title || '').trim(),
        status: String(status || '').trim(),
        progress: String(progress || '').trim(),
        bucket: String(bucket || '').trim(),
        resource: String(resource || '').trim(),
        dueDate: String(dueDate || '').trim(),
      };
    })
    .filter((task) => task.title);

  return {
    sheetName: firstSheetName,
    headers,
    tasks,
  };
}

function findColumnByNormalized(headers, target) {
  return (
    headers.find((h) => normalizeHeader(h) === target) ||
    headers.find((h) => normalizeHeader(h).includes(target)) ||
    null
  );
}

/**
 * Normalizes a resource string from any source format.
 * "AUGUSTO.FERBONINK" → "Augusto"
 * "Ivan Cavalcanti Pinto" → "Ivan Cavalcanti Pinto"  (preserved as-is)
 * "debora.campelo" → "Debora Campelo"
 */
function normalizeResourceName(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  // If it contains a dot but no space, treat as user.login format (e.g. AUGUSTO.FERBONINK)
  if (value.includes('.') && !value.includes(' ')) {
    return value
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  return value;
}

export function parseAFazerWorkbook(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return { sheetName: null, tasks: [] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rows.length) {
    return { sheetName: firstSheetName, tasks: [] };
  }

  const headers = Object.keys(rows[0]);
  const smsCol = findColumnByNormalized(headers, 'sms');
  const resumoCol = findColumnByNormalized(headers, 'resumo');
  const recursoCol = findColumnByNormalized(headers, 'recurso');

  const tasks = rows
    .map((row, index) => {
      const title = String(row[resumoCol] ?? '').trim();
      const idRaw = smsCol ? row[smsCol] : null;
      const id = idRaw !== null && idRaw !== '' ? Number(idRaw) || null : null;
      const resource = recursoCol ? normalizeResourceName(row[recursoCol]) : '';

      return {
        line: index + 2,
        id,
        type: extractTaskTypeFromTitle(title),
        title,
        status: 'A Fazer',
        progress: 'A Fazer',
        bucket: 'A Fazer',
        resource,
        dueDate: '',
        source: 'afazer',
      };
    })
    .filter((task) => task.title);

  return { sheetName: firstSheetName, headers, tasks };
}

function parsePendentesOrConcluidas(fileBuffer, source) {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return { sheetName: null, tasks: [] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rows.length) {
    return { sheetName: firstSheetName, tasks: [] };
  }

  const headers = Object.keys(rows[0]);
  const lineOffset = source === 'concluidas' ? 200000 : 100000;
  const bucket = source === 'concluidas' ? 'Concluídas' : 'Pendentes';

  const protocoloCol = findColumnByNormalized(headers, 'protocolo');
  const situacaoCol = findColumnByNormalized(headers, 'situacao');
  const resumoCol = findColumnByNormalized(headers, 'resumo');
  const recursoCol = findColumnByNormalized(headers, 'recurso');
  const prazoCol = findColumnByNormalized(headers, 'prazo');

  const tasks = rows
    .map((row, index) => {
      const title = String(row[resumoCol] ?? '').trim();
      const idRaw = protocoloCol ? row[protocoloCol] : null;
      const id = idRaw !== null && idRaw !== '' ? Number(idRaw) || null : null;
      const status = situacaoCol ? String(row[situacaoCol] ?? '').trim() : bucket;
      const resource = recursoCol ? normalizeResourceName(row[recursoCol]) : '';
      const dueDate = prazoCol ? String(row[prazoCol] ?? '').trim() : '';

      return {
        line: index + lineOffset + 2,
        id,
        type: extractTaskTypeFromTitle(title),
        title,
        status,
        progress: status,
        bucket,
        resource,
        dueDate,
        source,
      };
    })
    .filter((task) => task.title);

  return { sheetName: firstSheetName, headers, tasks };
}

export function parsePendentesWorkbook(fileBuffer) {
  return parsePendentesOrConcluidas(fileBuffer, 'pendentes');
}

export function parseConcluidasWorkbook(fileBuffer) {
  return parsePendentesOrConcluidas(fileBuffer, 'concluidas');
}

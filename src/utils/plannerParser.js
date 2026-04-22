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

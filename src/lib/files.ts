export type FileKind = 'numerical' | 'document' | 'image' | 'audio'

export type UploadedFile = {
  id: string
  file: File
  name: string
  size: number
  type: string
  lastModified: number
  ext: string
  kind: FileKind
  addedAt: number
}

export const ACCEPTED_EXTENSIONS = [
  // numerical / tabular
  'csv',
  'tsv',
  'xls',
  'xlsx',
  'xlsm',
  'ods',
  'parquet',
  'json',
  // documents + presentations
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'ppt',
  'pptx',
  'odp',
  'key',
  // images
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
  // audio
  'mp3',
  'wav',
  'flac',
  'ogg',
  'm4a',
  'aac',
  'wma',
] as const

export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

const NUMERICAL_EXTS = new Set([
  'csv',
  'tsv',
  'xls',
  'xlsx',
  'xlsm',
  'ods',
  'parquet',
  'json',
])
const DOCUMENT_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'ppt',
  'pptx',
  'odp',
  'key',
])
const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'])

export const FILE_SECTIONS: {
  kind: FileKind
  title: string
  hint: string
}[] = [
  {
    kind: 'numerical',
    title: 'Numerical data',
    hint: 'CSV · XLSX · ODS · Parquet · JSON',
  },
  {
    kind: 'document',
    title: 'Documents',
    hint: 'PDF · Word · ODT · PowerPoint · text',
  },
  {
    kind: 'image',
    title: 'Images',
    hint: 'PNG · JPG · WEBP · GIF · TIFF',
  },
  {
    kind: 'audio',
    title: 'Audio',
    hint: 'MP3 · WAV · FLAC · OGG · M4A',
  },
]

export function extensionOf(name: string) {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1)! : ''
}

export function kindOf(ext: string): FileKind | null {
  if (NUMERICAL_EXTS.has(ext)) return 'numerical'
  if (DOCUMENT_EXTS.has(ext)) return 'document'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  return null
}

export function isAccepted(file: File) {
  const ext = extensionOf(file.name)
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileFingerprint(file: Pick<File, 'name' | 'size' | 'lastModified'>) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

export function toUploadedFile(file: File, id = crypto.randomUUID()): UploadedFile | null {
  const ext = extensionOf(file.name)
  const kind = kindOf(ext)
  if (!kind) return null
  return {
    id,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    ext,
    kind,
    addedAt: Date.now(),
  }
}

export function groupByKind(files: UploadedFile[]) {
  return FILE_SECTIONS.map((section) => ({
    ...section,
    files: files.filter((f) => f.kind === section.kind),
  }))
}

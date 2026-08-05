export type AppStorageDatabaseSummary = {
  fileName: string
  label: string
  databaseBytes: number
  sidecarBytes: number
  totalBytes: number
  unavailable: boolean
}

export type AppStorageSummary = {
  userDataPath: string
  conversationDatabase: AppStorageDatabaseSummary
  databases: AppStorageDatabaseSummary[]
  totalBytes: number
  unavailable: boolean
}

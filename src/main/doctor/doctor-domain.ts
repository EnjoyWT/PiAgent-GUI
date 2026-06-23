import type {
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorDomainInfo
} from './doctor-types.ts'

export interface DoctorDomain {
  readonly info: DoctorDomainInfo
  listComponents(): Promise<DoctorComponentResult[]>
  getComponentStatus(componentId: string): Promise<DoctorComponentResult>
  getSummary(): Promise<DoctorDomainSummary>
}

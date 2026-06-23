import type { DoctorDomain } from './doctor-domain.ts'
import type {
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorDomainInfo
} from './doctor-types.ts'

export class DoctorService {
  private readonly domains = new Map<string, DoctorDomain>()

  register(domain: DoctorDomain): void {
    this.domains.set(domain.info.domainId, domain)
  }

  listDomains(): DoctorDomainInfo[] {
    return Array.from(this.domains.values()).map((domain) => ({ ...domain.info }))
  }

  async listComponents(domainId: string): Promise<DoctorComponentResult[]> {
    const domain = this.requireDomain(domainId)
    return await domain.listComponents()
  }

  async getComponentStatus(domainId: string, componentId: string): Promise<DoctorComponentResult> {
    const domain = this.requireDomain(domainId)
    return await domain.getComponentStatus(componentId)
  }

  async getDomainSummary(domainId: string): Promise<DoctorDomainSummary> {
    const domain = this.requireDomain(domainId)
    return await domain.getSummary()
  }

  private requireDomain(domainId: string): DoctorDomain {
    const domain = this.domains.get(domainId)
    if (!domain) throw new Error(`Doctor domain not found: ${domainId}`)
    return domain
  }
}

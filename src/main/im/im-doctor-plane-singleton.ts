import { ImDoctorPlane } from './im-doctor-plane.ts'

let imDoctorPlaneSingleton: ImDoctorPlane | null = null

export const getImDoctorPlane = (): ImDoctorPlane => {
  if (imDoctorPlaneSingleton) return imDoctorPlaneSingleton
  imDoctorPlaneSingleton = new ImDoctorPlane()
  return imDoctorPlaneSingleton
}

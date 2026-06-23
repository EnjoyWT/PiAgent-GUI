export type ComputerUseSetupCheckId =
  | 'helper'
  | 'accessibility'
  | 'screenRecording'
  | 'cgEventPostToPid'
  | 'cgEventSetWindowLocation'
  | 'backgroundClick'
  | 'backgroundKeyboard'
  | 'backgroundDrag'
  | 'backgroundScroll'

export type ComputerUseSetupCheck = {
  id: ComputerUseSetupCheckId
  label: string
  ok: boolean
  detail: string
}

export type ComputerUseSetupReport = {
  ready: boolean
  status: 'ready' | 'blocked'
  summary: string
  checks: ComputerUseSetupCheck[]
  helperPath: string | null
}

type ComputerUsePermissionState = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export type ComputerUseSettingsDoctor = {
  helper: {
    available: boolean
    path: string | null
  }
  permissions: {
    accessibility: ComputerUsePermissionState
    screenRecording: ComputerUsePermissionState
  }
  capabilities: {
    backgroundClick: boolean
    backgroundKeyboard?: boolean
    backgroundDrag?: boolean
    backgroundScroll?: boolean
    windowLocalBackgroundClick?: boolean
    privateSymbols?: {
      cgEventPostToPid: boolean
      cgEventSetWindowLocation: boolean
    }
  }
}

const permissionLabel = (state: ComputerUsePermissionState): string => {
  switch (state) {
    case 'granted':
      return '已授权'
    case 'denied':
      return '未授权'
    case 'restricted':
      return '受系统限制'
    case 'not-determined':
      return '尚未请求'
    default:
      return '状态未知'
  }
}

export const buildComputerUseSetupReport = (
  doctor: ComputerUseSettingsDoctor
): ComputerUseSetupReport => {
  const privateSymbols = doctor.capabilities.privateSymbols
  const checks: ComputerUseSetupCheck[] = [
    {
      id: 'helper',
      label: '原生 Helper',
      ok: doctor.helper.available,
      detail: doctor.helper.available ? '已安装' : '未安装'
    },
    {
      id: 'accessibility',
      label: '辅助功能权限',
      ok: doctor.permissions.accessibility === 'granted',
      detail: permissionLabel(doctor.permissions.accessibility)
    },
    {
      id: 'screenRecording',
      label: '屏幕录制权限',
      ok: doctor.permissions.screenRecording === 'granted',
      detail: permissionLabel(doctor.permissions.screenRecording)
    },
    {
      id: 'cgEventPostToPid',
      label: 'CGEventPostToPid',
      ok: privateSymbols?.cgEventPostToPid === true,
      detail: privateSymbols?.cgEventPostToPid === true ? '已解析' : '不可用'
    },
    {
      id: 'cgEventSetWindowLocation',
      label: 'CGEventSetWindowLocation',
      ok: privateSymbols?.cgEventSetWindowLocation === true,
      detail: privateSymbols?.cgEventSetWindowLocation === true ? '已解析' : '不可用'
    },
    {
      id: 'backgroundClick',
      label: '静默点击能力',
      ok:
        doctor.capabilities.backgroundClick &&
        doctor.capabilities.windowLocalBackgroundClick === true,
      detail:
        doctor.capabilities.backgroundClick &&
        doctor.capabilities.windowLocalBackgroundClick === true
          ? '已就绪'
          : '未就绪'
    },
    {
      id: 'backgroundKeyboard',
      label: '后台键盘输入',
      ok: doctor.capabilities.backgroundKeyboard === true,
      detail: doctor.capabilities.backgroundKeyboard === true ? '已就绪' : '未就绪'
    },
    {
      id: 'backgroundDrag',
      label: '后台拖拽',
      ok: doctor.capabilities.backgroundDrag === true,
      detail: doctor.capabilities.backgroundDrag === true ? '已就绪' : '未就绪'
    },
    {
      id: 'backgroundScroll',
      label: '后台滚动',
      ok: doctor.capabilities.backgroundScroll === true,
      detail: doctor.capabilities.backgroundScroll === true ? '已就绪' : '未就绪'
    }
  ]
  const ready = checks.every((item) => item.ok)
  const missingLabels = checks.filter((item) => !item.ok).map((item) => item.label)

  return {
    ready,
    status: ready ? 'ready' : 'blocked',
    summary: ready
      ? 'Computer Use 已就绪，可执行窗口观察、静默点击和后台输入。'
      : `Computer Use 还缺少：${missingLabels.join('、')}。`,
    checks,
    helperPath: doctor.helper.path
  }
}

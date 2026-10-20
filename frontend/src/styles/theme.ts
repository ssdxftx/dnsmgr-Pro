import type { GlobalThemeOverrides } from 'naive-ui';

/**
 * Glass NOC（玻璃控制塔）设计系统的 naive-ui 主题覆盖。
 *
 * 原则：
 * - 唯一信号强调色：信号青（信号绿）—— 亮色用 #0a7a5c（保证正文级对比度 ≥4.5），
 *   暗色用 #2ee6b6（在深色底上高对比、且按钮上用深色文字）。
 * - 状态色（success/warning/error）仅用于健康指示，不抢强调色。
 * - 结构与原有 theme.ts 完全一致，所有 override 键保留，确保不重排任何组件。
 */

const FONT_FAMILY =
  "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO =
  "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

interface Brand {
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  primarySuppl: string;
  info: string;
  success: string;
  warning: string;
  error: string;
  ink: string; // 主按钮文字色（在强调色背景上保证对比）
  ring: string; // 焦点/输入框光晕
}

const lightBrand: Brand = {
  primary: '#0a7a5c',
  primaryHover: '#0d9070',
  primaryPressed: '#086a50',
  primarySuppl: '#0a7a5c',
  info: '#0a7a5c',
  success: '#16a34a',
  warning: '#d97706',
  error: '#e5484d',
  ink: '#ffffff',
  ring: 'rgba(10, 122, 92, 0.16)',
};

const darkBrand: Brand = {
  primary: '#2ee6b6',
  primaryHover: '#5deecb',
  primaryPressed: '#17c39a',
  primarySuppl: '#2ee6b6',
  info: '#2ee6b6',
  success: '#34d399',
  warning: '#fbbf24',
  error: '#fb7185',
  ink: '#04140f',
  ring: 'rgba(46, 230, 182, 0.18)',
};

interface Surface {
  body: string;
  card: string;
  modal: string;
  popover: string;
  tableHead: string;
  hover: string;
  text1: string;
  text2: string;
  text3: string;
  border: string;
  divider: string;
  inputBg: string;
  action: string;
  menuActive: string;
  menuActiveHover: string;
}

const lightColors: Surface = {
  body: '#eef2f8',
  card: '#ffffff',
  modal: '#ffffff',
  popover: '#ffffff',
  tableHead: '#f2f6fb',
  hover: '#f0f4fa',
  text1: '#0f1b2d',
  text2: '#4a5872',
  text3: '#8593a8',
  border: '#dde5f0',
  divider: '#e8edf5',
  inputBg: '#fbfdff',
  action: '#f0f4fa',
  menuActive: '#e3f4ee',
  menuActiveHover: '#d5efe7',
};

const darkColors: Surface = {
  body: '#0a0e16',
  card: '#111927',
  modal: '#141d2d',
  popover: '#161f30',
  tableHead: '#16202f',
  hover: '#16202f',
  text1: '#e8edf5',
  text2: '#9aa7bd',
  text3: '#5e6b82',
  border: '#24314e',
  divider: '#1b2538',
  inputBg: '#101725',
  action: '#16202f',
  menuActive: '#123128',
  menuActiveHover: '#173a33',
};

function buildOverrides(c: Surface, b: Brand, dark: boolean): GlobalThemeOverrides {
  const shadowSoft = dark ? '0 8px 28px rgba(0, 0, 0, 0.45)' : '0 10px 30px rgba(20, 35, 60, 0.10)';
  return {
    common: {
      fontFamily: FONT_FAMILY,
      fontFamilyMono: FONT_MONO,
      fontWeightStrong: '600',
      fontSize: '14px',
      fontSizeSmall: '13px',
      fontSizeLarge: '15px',
      lineHeight: '1.6',
      borderRadius: '10px',
      borderRadiusSmall: '8px',
      heightMedium: '36px',
      heightLarge: '42px',
      primaryColor: b.primary,
      primaryColorHover: b.primaryHover,
      primaryColorPressed: b.primaryPressed,
      primaryColorSuppl: b.primarySuppl,
      infoColor: b.info,
      infoColorHover: b.primaryHover,
      infoColorPressed: b.primaryPressed,
      successColor: b.success,
      warningColor: b.warning,
      errorColor: b.error,
      bodyColor: c.body,
      cardColor: c.card,
      modalColor: c.modal,
      popoverColor: c.popover,
      tableColor: c.card,
      tableHeaderColor: c.tableHead,
      inputColor: c.inputBg,
      actionColor: c.action,
      hoverColor: c.hover,
      textColorBase: c.text1,
      textColor1: c.text1,
      textColor2: c.text2,
      textColor3: c.text3,
      borderColor: c.border,
      dividerColor: c.divider,
      boxShadow1: dark ? '0 2px 8px rgba(0, 0, 0, 0.4)' : '0 2px 8px rgba(20, 35, 60, 0.06)',
      boxShadow2: shadowSoft,
      boxShadow3: dark ? '0 18px 48px rgba(0, 0, 0, 0.55)' : '0 18px 48px rgba(20, 35, 60, 0.16)',
    },
    Card: {
      color: c.card,
      borderColor: c.divider,
      borderRadius: '16px',
      paddingMedium: '20px 22px',
      titleFontSizeMedium: '16px',
      titleFontWeight: '600',
      titleTextColor: c.text1,
    },
    Button: {
      borderRadiusMedium: '10px',
      borderRadiusSmall: '8px',
      fontWeight: '500',
      fontWeightStrong: '600',
      // 主按钮文字色随主题切换，保证在强调色背景上可读
      textColorPrimary: b.ink,
      textColorHoverPrimary: b.ink,
      textColorPressedPrimary: b.ink,
      textColorFocusPrimary: b.ink,
      textColorDisabledPrimary: dark ? 'rgba(4, 20, 15, 0.5)' : 'rgba(255, 255, 255, 0.6)',
    },
    Input: {
      borderRadius: '10px',
      color: c.inputBg,
      colorFocus: dark ? '#141d2d' : '#ffffff',
      border: `1px solid ${c.border}`,
      borderHover: `1px solid ${dark ? '#3b4a66' : '#b9cbe0'}`,
      borderFocus: `1px solid ${b.primary}`,
      boxShadowFocus: `0 0 0 3px ${b.ring}`,
      caretColor: b.primary,
    },
    DataTable: {
      borderRadius: '12px',
      thColor: c.tableHead,
      thTextColor: c.text2,
      thFontWeight: '600',
      tdColor: c.card,
      tdColorHover: c.hover,
      borderColor: c.divider,
      thPaddingMedium: '12px 14px',
      tdPaddingMedium: '12px 14px',
    },
    Menu: {
      itemHeight: '40px',
      borderRadius: '10px',
      itemColorActive: c.menuActive,
      itemColorActiveHover: c.menuActiveHover,
      itemColorActiveCollapsed: c.menuActive,
      itemTextColorActive: b.primaryPressed,
      itemTextColorActiveHover: b.primaryPressed,
      itemIconColorActive: b.primaryPressed,
      itemIconColorActiveHover: b.primaryPressed,
      itemColorHover: c.hover,
      arrowColor: c.text3,
      groupTextColor: c.text3,
    },
    Layout: {
      color: c.body,
      siderColor: c.card,
      headerColor: c.card,
      bodyColor: c.body,
      headerBorderColor: c.divider,
      siderBorderColor: c.divider,
    },
    Form: {
      labelFontWeight: '500',
      labelTextColor: c.text2,
      feedbackHeightMedium: '22px',
    },
    Modal: {
      borderRadius: '16px',
      color: c.modal,
    },
    Dialog: {
      borderRadius: '16px',
      color: c.modal,
    },
    Popover: {
      color: c.popover,
      borderRadius: '12px',
      boxShadow: shadowSoft,
    },
    Dropdown: {
      color: c.popover,
      borderRadius: '12px',
    },
    Tag: {
      borderRadius: '8px',
    },
    Tabs: {
      tabBorderRadius: '10px',
      tabFontWeightActive: '600',
    },
    Statistic: {
      labelTextColor: c.text3,
      valueTextColor: c.text1,
    },
    Divider: {
      color: c.divider,
    },
    Notification: {
      borderRadius: '14px',
    },
    Message: {
      borderRadius: '12px',
    },
  };
}

export const lightThemeOverrides: GlobalThemeOverrides = buildOverrides(lightColors, lightBrand, false);
export const darkThemeOverrides: GlobalThemeOverrides = buildOverrides(darkColors, darkBrand, true);

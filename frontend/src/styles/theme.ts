import type { GlobalThemeOverrides } from 'naive-ui';

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
const FONT_MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

const brand = {
  primary: '#3b6df0',
  primaryHover: '#5b87f5',
  primaryPressed: '#2c59d0',
  primarySuppl: '#3b6df0',
  info: '#3b6df0',
  success: '#16a34a',
  warning: '#f59e0b',
  error: '#e5484d',
};

const lightColors = {
  body: '#f6f8fc',
  card: '#ffffff',
  modal: '#ffffff',
  popover: '#ffffff',
  tableHead: '#f6f8fc',
  hover: '#f8faff',
  text1: '#1f2a44',
  text2: '#42506b',
  text3: '#8a99b5',
  border: '#e6ebf4',
  divider: '#eef1f7',
  inputBg: '#fbfcfe',
  action: '#f4f7fd',
  menuActive: '#eef4ff',
  menuActiveHover: '#e6efff',
};

const darkColors = {
  body: '#0e1524',
  card: '#161f33',
  modal: '#161f33',
  popover: '#1a2439',
  tableHead: '#1b2540',
  hover: '#1e2a44',
  text1: '#e8eefb',
  text2: '#a8b6d4',
  text3: '#6f7f9e',
  border: '#26314b',
  divider: '#222d47',
  inputBg: '#1a2439',
  action: '#1e2a44',
  menuActive: '#1c2a4d',
  menuActiveHover: '#22335c',
};

function buildOverrides(c: typeof lightColors, dark = false): GlobalThemeOverrides {
  const shadowSoft = dark ? '0 8px 28px rgba(0, 0, 0, 0.45)' : '0 10px 30px rgba(31, 42, 68, 0.08)';
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
      primaryColor: brand.primary,
      primaryColorHover: brand.primaryHover,
      primaryColorPressed: brand.primaryPressed,
      primaryColorSuppl: brand.primarySuppl,
      infoColor: brand.info,
      infoColorHover: brand.primaryHover,
      infoColorPressed: brand.primaryPressed,
      successColor: brand.success,
      warningColor: brand.warning,
      errorColor: brand.error,
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
      boxShadow1: dark ? '0 2px 8px rgba(0, 0, 0, 0.4)' : '0 2px 8px rgba(31, 42, 68, 0.06)',
      boxShadow2: shadowSoft,
      boxShadow3: dark ? '0 18px 48px rgba(0, 0, 0, 0.55)' : '0 18px 48px rgba(31, 42, 68, 0.16)',
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
    },
    Input: {
      borderRadius: '10px',
      color: c.inputBg,
      colorFocus: dark ? '#1e2a44' : '#ffffff',
      border: `1px solid ${c.border}`,
      borderHover: `1px solid ${dark ? '#3b5588' : '#bdd0ff'}`,
      borderFocus: `1px solid ${brand.primary}`,
      boxShadowFocus: '0 0 0 3px rgba(59, 109, 240, 0.14)',
      caretColor: brand.primary,
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
      itemTextColorActive: brand.primaryPressed,
      itemTextColorActiveHover: brand.primaryPressed,
      itemIconColorActive: brand.primaryPressed,
      itemIconColorActiveHover: brand.primaryPressed,
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

export const lightThemeOverrides: GlobalThemeOverrides = buildOverrides(lightColors, false);
export const darkThemeOverrides: GlobalThemeOverrides = buildOverrides(darkColors, true);
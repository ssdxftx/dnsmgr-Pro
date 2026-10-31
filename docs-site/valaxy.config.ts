import type { PressTheme } from 'valaxy-theme-press'
import { fileURLToPath } from 'node:url'
import { defineValaxyConfig } from 'valaxy'
import { addonAlgolia } from 'valaxy-addon-algolia'

const SITE_URL = process.env.SITE_URL || 'https://github.com/ssdxftx/dnsmgr-Pro'

export default defineValaxyConfig<PressTheme.Config>({
  siteConfig: {
    lang: 'zh-CN',
    languages: ['zh-CN'],
    title: '彩虹 DNS Pro 文档',
    url: SITE_URL,
    description: '从部署到日常运维的彩虹 DNS Pro 使用手册',
    author: {
      name: '彩虹 DNS Pro',
      link: 'https://github.com/ssdxftx/dnsmgr-Pro',
    },
    search: {
      enable: false,
    },
    mediumZoom: {
      enable: true,
    },
  },

  addons: [
    addonAlgolia({
      appId: 'DNSMGRDOCS',
      apiKey: 'local-docs-search-disabled',
      indexName: 'dnsmgr-pro-docs',
    }),
  ],

  theme: 'press',
  themeConfig: {
    logo: '/logo.svg',
    sidebar: ['guide', 'deploy', 'dns', 'cdn', 'cert', 'ops', 'system', 'api', 'faq'],
    socialLinks: [
      { icon: 'i-ri-github-line', link: 'https://github.com/ssdxftx/dnsmgr-Pro' },
    ],
    nav: [
      { text: '开始使用', link: '/guide/' },
      { text: '部署', link: '/deploy/' },
      { text: 'DNS', link: '/dns/' },
      { text: 'CDN', link: '/cdn/' },
      { text: '证书与部署', link: '/cert/' },
      { text: '运维', link: '/ops/' },
      { text: '系统', link: '/system/' },
      { text: 'API', link: '/api/' },
      { text: '常见问题', link: '/faq/' },
    ],
    editLink: {
      pattern: 'https://github.com/ssdxftx/dnsmgr-Pro/edit/main/docs-site/pages/:path',
    },
    footer: {
      message: '彩虹 DNS Pro 使用文档',
      copyright: `MIT Licensed | © 2026 彩虹 DNS Pro 贡献者`,
    },
  },

  vite: {
    ssgOptions: {
      dirStyle: 'nested',
    },
    resolve: {
      alias: {
        'valaxy-theme-press/components/PressDocFooterLastUpdated.vue':
          fileURLToPath(new URL('./components/PressDocFooterLastUpdated.vue', import.meta.url)),
      },
    },
    server: {
      allowedHosts: ['.monkeycode-ai.online'],
    },
    preview: {
      allowedHosts: ['.monkeycode-ai.online'],
    },
  },

  markdown: {
    blocks: {
      tip: { icon: 'i-carbon-thumbs-up' },
      warning: { icon: 'i-carbon-warning-alt' },
      danger: { icon: 'i-carbon-warning' },
      info: { icon: 'i-carbon-information' },
    },
  },

  modules: {
    rss: {
      enable: false,
    },
  },
})

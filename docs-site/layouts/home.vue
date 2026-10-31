<script setup lang="ts">
const features = [
  {
    title: '域名与解析',
    desc: '22 家 DNS 服务商，域名导入、批量解析、权重、别名、到期提醒与劫持检测。',
    link: '/dns/',
  },
  {
    title: 'CDN 与边缘',
    desc: '12 家 CDN 厂商，缓存规则、刷新预热、站点规则、Cloudflare Tunnel 与 ESA。',
    link: '/cdn/',
  },
  {
    title: '证书与部署',
    desc: 'ACME 签发、自动续签、CNAME 代理，以及面板、WAF、CDN 与服务器部署。',
    link: '/cert/',
  },
  {
    title: '运维与安全',
    desc: '容灾切换、定时任务、优选 IP、加密备份、凭证保险库与 API Key 治理。',
    link: '/ops/',
  },
]

const links = [
  { text: '快速开始', link: '/guide/', primary: true },
  { text: 'Docker 部署', link: '/deploy/docker' },
  { text: 'API 集成', link: '/api/' },
]
</script>

<template>
  <Layout>
    <div class="home-shell">
      <section class="hero">
        <div class="hero-mark">
          <img src="/logo.svg" alt="彩虹 DNS Pro">
        </div>
        <p class="eyebrow">彩虹 DNS Pro 使用文档</p>
        <h1>从部署到日常运维的完整手册</h1>
        <p class="lead">
          覆盖 DNS 解析、CDN、SSL 证书、自动部署、容灾切换、备份与 API 自动化。
          按模块说明操作步骤、权限边界、验证方式与排错路径。
        </p>
        <div class="actions">
          <a
            v-for="item in links"
            :key="item.link"
            :href="item.link"
            class="action"
            :class="{ primary: item.primary }"
          >
            {{ item.text }}
          </a>
        </div>
        <p class="version">当前文档版本 v1.32.0</p>
      </section>

      <section class="features">
        <a
          v-for="item in features"
          :key="item.title"
          :href="item.link"
          class="feature"
        >
          <h2>{{ item.title }}</h2>
          <p>{{ item.desc }}</p>
          <span>查看文档</span>
        </a>
      </section>

      <section class="quick">
        <div>
          <h2>第一次使用</h2>
          <p>从部署、初始化、DNS 账户接入到第一条解析记录，按顺序完成即可上线。</p>
        </div>
        <ol>
          <li><a href="/deploy/">选择部署方式</a></li>
          <li><a href="/deploy/install">完成初始化安装</a></li>
          <li><a href="/dns/accounts">接入 DNS 账户</a></li>
          <li><a href="/dns/domains">导入域名并维护解析</a></li>
          <li><a href="/faq/security">完成安全加固</a></li>
        </ol>
      </section>
    </div>
  </Layout>
</template>

<style scoped>
.home-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 72px 24px 96px;
}

.hero {
  text-align: center;
  padding: 24px 0 56px;
}

.hero-mark {
  width: 72px;
  height: 72px;
  margin: 0 auto 20px;
}

.hero-mark img {
  width: 100%;
  height: 100%;
  border-radius: 18px;
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--va-c-brand);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.hero h1 {
  margin: 0;
  font-size: clamp(34px, 6vw, 56px);
  line-height: 1.12;
  letter-spacing: -0.03em;
}

.lead {
  max-width: 760px;
  margin: 20px auto 0;
  color: var(--va-c-text-2);
  font-size: 17px;
  line-height: 1.8;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 28px;
}

.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 132px;
  padding: 11px 20px;
  border: 1px solid var(--va-c-divider);
  border-radius: 999px;
  color: var(--va-c-text-1);
  font-weight: 600;
  text-decoration: none;
  transition: 0.2s ease;
}

.action:hover {
  border-color: var(--va-c-brand);
  color: var(--va-c-brand);
}

.action.primary {
  border-color: transparent;
  background: var(--va-c-brand);
  color: #fff;
}

.action.primary:hover {
  opacity: 0.9;
  color: #fff;
}

.version {
  margin-top: 18px;
  color: var(--va-c-text-3);
  font-size: 13px;
}

.features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.feature {
  display: flex;
  flex-direction: column;
  min-height: 172px;
  padding: 24px;
  border: 1px solid var(--va-c-divider);
  border-radius: 16px;
  background: var(--va-c-bg-soft);
  color: inherit;
  text-decoration: none;
  transition: 0.2s ease;
}

.feature:hover {
  border-color: var(--va-c-brand);
  transform: translateY(-2px);
}

.feature h2 {
  margin: 0 0 10px;
  font-size: 20px;
}

.feature p {
  margin: 0;
  color: var(--va-c-text-2);
  line-height: 1.75;
}

.feature span {
  margin-top: auto;
  padding-top: 18px;
  color: var(--va-c-brand);
  font-size: 14px;
  font-weight: 600;
}

.quick {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 48px;
  padding: 28px;
  border: 1px solid var(--va-c-divider);
  border-radius: 16px;
}

.quick h2 {
  margin: 0 0 10px;
  font-size: 22px;
}

.quick p {
  margin: 0;
  color: var(--va-c-text-2);
  line-height: 1.75;
}

.quick ol {
  margin: 0;
  padding-left: 20px;
  line-height: 2;
}

.quick a {
  color: var(--va-c-brand);
}

@media (max-width: 720px) {
  .home-shell {
    padding: 48px 18px 72px;
  }

  .features,
  .quick {
    grid-template-columns: 1fr;
  }
}
</style>

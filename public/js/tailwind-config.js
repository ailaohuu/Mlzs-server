// Tailwind Play CDN 主题配置（index.html / admin.html / login.html 共用）
// 必须在 cdn.tailwindcss.com 之后、页面内容渲染之前加载
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: '#165DFF',
        success: '#00B42A',
      }
    }
  }
}

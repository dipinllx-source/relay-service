<template>
  <!--
    对外页共用页脚。原先 LandingView / StartView / TutorialLandingView
    各自维护一份，三份标记字节完全相同（各 191 字节）。
  -->
  <footer class="foot">
    <div class="foot__inner">
      <span>Relay Service</span>
      <span class="foot__sep">·</span>
      <span>多平台 AI API 中转</span>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  background: #f5f5f7;
  border-top: 1px solid #d2d2d7;
  padding: 28px 22px;
}
.foot__inner {
  max-width: 1100px;
  margin: 0 auto;
  font-size: 12px;
  color: #6e6e73;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.foot__sep {
  opacity: 0.5;
}

.dark .foot {
  background: #0b1220;
  border-top: 1px solid #374151;
}
.dark .foot__inner {
  color: #9ca3af;
}
</style>

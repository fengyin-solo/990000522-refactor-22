<template>
  <div class="state-view" :class="{ 'state-view--padded': padded && status !== 'ready' }">
    <!-- Loading -->
    <div v-if="status === 'loading'" class="state-block">
      <el-icon class="is-loading" :size="iconSize"><Loading /></el-icon>
      <p>{{ loadingText }}</p>
    </div>

    <!-- Error -->
    <el-result
      v-else-if="status === 'error'"
      icon="error"
      :title="errorTitle"
      :sub-title="error"
    >
      <template #extra>
        <el-button v-if="retryable" type="primary" :icon="RefreshRight" @click="$emit('retry')">
          Retry
        </el-button>
        <slot name="error-extra" />
      </template>
    </el-result>

    <!-- Empty -->
    <el-empty v-else-if="status === 'empty'" :description="emptyText">
      <slot name="empty-extra" />
    </el-empty>

    <slot v-else />
  </div>
</template>

<script setup>
import { Loading, RefreshRight } from '@element-plus/icons-vue'

const props = defineProps({
  status: { type: String, required: true }, // loading | error | empty | ready
  error: { type: String, default: '' },
  loadingText: { type: String, default: 'Loading...' },
  errorTitle: { type: String, default: 'Something went wrong' },
  emptyText: { type: String, default: 'Nothing here yet' },
  retryable: { type: Boolean, default: true },
  padded: { type: Boolean, default: true },
  iconSize: { type: Number, default: 32 }
})

defineEmits(['retry'])
</script>

<style scoped>
.state-block {
  text-align: center;
  padding: 60px;
  color: #909399;
}

.state-block p {
  margin-top: 12px;
}

.state-view--padded {
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.state-view--padded > * {
  width: 100%;
}
</style>

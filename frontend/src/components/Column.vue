<template>
  <div class="column">
    <div class="column-header">
      <div v-if="!isEditing" class="column-title" @dblclick="startEditing">
        <h3>{{ column.name }}</h3>
        <el-tag size="small" round>{{ cards.length }}</el-tag>
      </div>
      <div v-else class="column-edit">
        <el-input
          ref="editInputRef"
          v-model="editName"
          size="small"
          @keyup.enter="saveRename"
          @blur="saveRename"
        />
      </div>
      <el-dropdown trigger="click" @command="handleCommand">
        <el-button text size="small" :icon="MoreFilled" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="rename">Rename</el-dropdown-item>
            <el-dropdown-item command="delete" divided>Delete Column</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="column-cards">
      <div v-if="cardStatus === 'loading'" class="card-state card-state-loading">
        <el-icon class="is-loading" :size="18"><Loading /></el-icon>
        <span>Loading cards...</span>
      </div>

      <div v-else-if="cardStatus === 'error'" class="card-state card-state-error">
        <el-text type="danger" size="small">{{ cardError || 'Failed to load cards' }}</el-text>
        <el-button size="small" type="danger" plain @click="$emit('retry-cards', column.id)">
          Retry
        </el-button>
      </div>

      <template v-else>
        <draggable
          :model-value="cards"
          item-key="id"
          group="cards"
          ghost-class="card-ghost"
          animation="200"
          :data-column-id="column.id"
          @end="onCardDragEnd"
        >
          <template #item="{ element: card }">
            <TaskCard
              :card="card"
              :all-columns="allColumns"
              @edit="$emit('edit-card', card)"
              @delete="$emit('delete-card', card)"
              @move="(targetColId) => $emit('move-card', card.id, targetColId, 0)"
            />
          </template>
        </draggable>

        <div v-if="cards.length === 0" class="card-state card-state-empty">
          <el-text type="info" size="small">No cards yet</el-text>
        </div>
      </template>
    </div>

    <div class="column-footer">
      <el-button text type="primary" :icon="Plus" @click="$emit('add-card', column.id)">
        Add Card
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { MoreFilled, Plus, Loading } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import TaskCard from './TaskCard.vue'

const props = defineProps({
  column: { type: Object, required: true },
  cards: { type: Array, default: () => [] },
  // Shared per-column card state derived in the store:
  // { status: 'loading' | 'success' | 'error', error }
  cardState: { type: Object, default: null },
  allColumns: { type: Array, default: () => [] }
})

const emit = defineEmits(['add-card', 'edit-card', 'delete-card', 'move-card', 'rename-column', 'delete-column', 'retry-cards'])

const cardStatus = computed(() => props.cardState?.status || 'success')
const cardError = computed(() => props.cardState?.error || null)

const isEditing = ref(false)
const editName = ref('')
const editInputRef = ref(null)

function startEditing() {
  editName.value = props.column.name
  isEditing.value = true
  nextTick(() => {
    editInputRef.value?.focus()
  })
}

function saveRename() {
  if (editName.value.trim() && editName.value.trim() !== props.column.name) {
    emit('rename-column', props.column.id, editName.value.trim())
  }
  isEditing.value = false
}

function handleCommand(command) {
  if (command === 'rename') {
    startEditing()
  } else if (command === 'delete') {
    emit('delete-column', props.column)
  }
}

// The DOM already reflects the drag (vuedraggable is optimistic); emit
// the move so the single store action applies and reconciles the same
// state the user just saw. Sortable fires `end` once, on the source
// column, for both same-column reorders and cross-column moves.
function onCardDragEnd(evt) {
  if (cardStatus.value !== 'success') return

  const cardId = evt.item?.__draggable_context?.element?.id
  if (!cardId) return

  const toColumnId = Number(evt.to?.dataset?.columnId)
  if (!toColumnId) return

  emit('move-card', cardId, toColumnId, evt.newIndex ?? 0, { silent: true })
}
</script>

<style scoped>
.column {
  width: 300px;
  min-width: 300px;
  background: #f4f5f7;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 160px);
}

.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px 8px;
}

.column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

.column-title h3 {
  font-size: 15px;
  color: #303133;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-edit {
  flex: 1;
  margin-right: 8px;
}

.column-cards {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  min-height: 60px;
}

.card-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 8px;
  text-align: center;
}

.card-state-loading {
  color: #909399;
}

.card-state-empty {
  padding: 12px 8px;
}

.column-cards::-webkit-scrollbar {
  width: 6px;
}

.column-cards::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.column-footer {
  padding: 8px;
  border-top: 1px solid #e4e7ed;
}

.card-ghost {
  opacity: 0.5;
  background: #e8f4ff;
  border-radius: 6px;
}
</style>

<template>
  <div class="board-page">
    <div class="board-header">
      <div class="board-title">
        <el-button text :icon="ArrowLeft" @click="$router.push('/')">Back</el-button>
        <h2 v-if="boardStore.currentBoard">{{ boardStore.currentBoard.name }}</h2>
      </div>
      <div class="board-actions">
        <el-button
          v-if="!boardStore.boardLoading && !boardStore.boardFailed"
          type="primary"
          :icon="Plus"
          @click="showAddColumn = true"
        >
          Add Column
        </el-button>
      </div>
    </div>

    <div v-if="boardStore.boardLoading" class="loading-state">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p>Loading board...</p>
    </div>

    <div v-else-if="boardStore.boardFailed" class="error-state">
      <el-result icon="error" :title="boardStore.boardError || 'Failed to load board'">
        <template #extra>
          <el-button @click="$router.push('/')">Back to boards</el-button>
          <el-button type="primary" @click="reloadBoard">Retry</el-button>
        </template>
      </el-result>
    </div>

    <div v-else-if="boardStore.columns.length === 0" class="empty-state">
      <el-empty description="No columns yet. Add your first column to get started!">
        <el-button type="primary" :icon="Plus" @click="showAddColumn = true">Add Column</el-button>
      </el-empty>
    </div>

    <div v-else class="columns-container">
      <el-alert
        v-if="boardStore.partialFailure"
        class="partial-failure-banner"
        type="warning"
        show-icon
        :closable="false"
        :title="`${boardStore.failedColumns.length} column(s) couldn't be loaded`"
      >
        <div class="partial-failure-actions">
          <span>Cards in those columns are temporarily unavailable.</span>
          <el-button size="small" type="warning" :loading="retrying" @click="retryFailedColumns">
            Retry
          </el-button>
        </div>
      </el-alert>

      <draggable
        v-model="boardStore.columns"
        item-key="id"
        class="columns-wrapper"
        ghost-class="column-ghost"
        animation="200"
        @end="onColumnDragEnd"
      >
        <template #item="{ element: column }">
          <Column
            :column="column"
            :cards="boardStore.cards[column.id] || []"
            :card-state="boardStore.cardStatuses[column.id]"
            :all-columns="boardStore.columns"
            @add-card="handleAddCard"
            @edit-card="openCardDetail"
            @delete-card="confirmDeleteCard"
            @move-card="handleMoveCard"
            @rename-column="handleRenameColumn"
            @delete-column="confirmDeleteColumn"
            @retry-cards="handleRetryColumn"
          />
        </template>
      </draggable>
    </div>

    <!-- Add Column Dialog -->
    <el-dialog v-model="showAddColumn" title="Add Column" width="400px" :close-on-click-modal="false">
      <el-form @submit.prevent="handleAddColumn">
        <el-form-item label="Column Name">
          <el-input v-model="newColumnName" placeholder="Enter column name" @keyup.enter="handleAddColumn" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddColumn = false">Cancel</el-button>
        <el-button type="primary" :disabled="!newColumnName.trim()" @click="handleAddColumn">Add</el-button>
      </template>
    </el-dialog>

    <!-- Add Card Dialog -->
    <AddCardForm
      v-model:visible="showAddCard"
      :column-id="addingToColumnId"
      @added="onCardAdded"
    />

    <!-- Card Detail Dialog -->
    <CardDetail
      v-model:visible="showCardDetail"
      :card="selectedCard"
      :all-columns="boardStore.columns"
      @updated="onCardUpdated"
      @move="handleMoveCard"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, ArrowLeft, Loading } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import { useBoardStore } from '../stores/board.js'
import Column from '../components/Column.vue'
import AddCardForm from '../components/AddCardForm.vue'
import CardDetail from '../components/CardDetail.vue'

const route = useRoute()
const router = useRouter()
const boardStore = useBoardStore()

const showAddColumn = ref(false)
const newColumnName = ref('')
const showAddCard = ref(false)
const addingToColumnId = ref(null)
const showCardDetail = ref(false)
const selectedCard = ref(null)
const retrying = ref(false)

onMounted(() => {
  reloadBoard()
})

onUnmounted(() => {
  boardStore.clearBoard()
})

function reloadBoard() {
  const boardId = parseInt(route.params.id)
  // loadBoard derives every workspace state (loading / failure /
  // partial failure / empty / ready); the template only renders it.
  boardStore.loadBoard(boardId).catch(() => {
    // Hard failure is shown inline via boardStore.boardFailed.
  })
}

async function retryFailedColumns() {
  retrying.value = true
  try {
    await boardStore.retryFailedColumns()
    if (!boardStore.partialFailure) ElMessage.success('All columns loaded')
  } catch (err) {
    // Columns that still failed keep their inline retry state.
  } finally {
    retrying.value = false
  }
}

function handleRetryColumn(columnId) {
  boardStore.loadColumnCards(columnId, { keepPrevious: false, markLoading: true }).catch(() => {
    // Error stays visible in the column's card-state.
  })
}

async function handleAddColumn() {
  if (!newColumnName.value.trim()) return
  try {
    await boardStore.addColumn(boardStore.currentBoard.id, newColumnName.value.trim())
    newColumnName.value = ''
    showAddColumn.value = false
    ElMessage.success('Column added')
  } catch (err) {
    ElMessage.error('Failed to add column')
  }
}

function handleAddCard(columnId) {
  addingToColumnId.value = columnId
  showAddCard.value = true
}

function onCardAdded() {
  showAddCard.value = false
}

function openCardDetail(card) {
  selectedCard.value = { ...card }
  showCardDetail.value = true
}

function onCardUpdated(updatedCard) {
  selectedCard.value = { ...updatedCard }
}

async function confirmDeleteCard(card) {
  try {
    await ElMessageBox.confirm(
      `Delete "${card.title}"?`,
      'Delete Card',
      { type: 'warning', confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }
    )
    await boardStore.deleteCard(card.id)
    ElMessage.success('Card deleted')
  } catch (err) {
    // cancelled
  }
}

async function handleMoveCard(cardId, targetColumnId, position, options = {}) {
  try {
    await boardStore.moveCard(cardId, targetColumnId, position)
    if (!options.silent) ElMessage.success('Card moved')
  } catch (err) {
    ElMessage.error('Failed to move card')
  }
}

async function handleRenameColumn(columnId, newName) {
  try {
    await boardStore.renameColumn(columnId, newName)
    ElMessage.success('Column renamed')
  } catch (err) {
    ElMessage.error('Failed to rename column')
  }
}

async function confirmDeleteColumn(column) {
  const cardCount = (boardStore.cards[column.id] || []).length
  const msg = cardCount > 0
    ? `Delete "${column.name}" and its ${cardCount} card(s)?`
    : `Delete "${column.name}"?`
  try {
    await ElMessageBox.confirm(msg, 'Delete Column', {
      type: 'warning',
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel'
    })
    await boardStore.deleteColumn(column.id)
    ElMessage.success('Column deleted')
  } catch (err) {
    // cancelled
  }
}

async function onColumnDragEnd() {
  // Columns were already reordered optimistically by vuedraggable;
  // the store persists positions and reconciles on failure.
  try {
    await boardStore.persistColumnOrder()
  } catch (err) {
    ElMessage.error('Failed to reorder columns')
  }
}
</script>

<style scoped>
.board-page {
  padding: 20px;
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
}

.board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.board-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.board-title h2 {
  font-size: 22px;
  color: #303133;
}

.columns-container {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

.columns-wrapper {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 400px;
}

.column-ghost {
  opacity: 0.5;
  background: #e8f4ff;
  border-radius: 8px;
}

.loading-state {
  text-align: center;
  padding: 60px;
  color: #909399;
}

.loading-state p {
  margin-top: 12px;
}

.error-state,
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.partial-failure-banner {
  margin-bottom: 16px;
  flex-shrink: 0;
}

.partial-failure-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>

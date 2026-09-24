<template>
  <div class="board-page">
    <div class="board-header">
      <div class="board-title">
        <el-button text :icon="ArrowLeft" @click="$router.push('/')">Back</el-button>
        <h2 v-if="boardStore.currentBoard">{{ boardStore.currentBoard.name }}</h2>
      </div>
      <div class="board-actions">
        <el-button
          v-if="boardStore.boardView.status === 'ready' || boardStore.boardView.status === 'empty'"
          type="primary"
          :icon="Plus"
          @click="showAddColumn = true"
        >
          Add Column
        </el-button>
      </div>
    </div>

    <StateView
      :status="boardStore.boardView.status"
      :error="boardStore.boardView.error"
      loading-text="Loading board..."
      error-title="Failed to load board"
      @retry="reloadBoard"
    >
      <template v-if="boardStore.boardView.status === 'empty'" #empty-extra>
        <el-button type="primary" :icon="Plus" @click="showAddColumn = true">
          Add Column
        </el-button>
      </template>

      <div v-if="boardStore.boardView.status === 'ready'" class="columns-container">
        <draggable
          v-model="boardStore.columns"
          item-key="id"
          class="columns-wrapper"
          ghost-class="column-ghost"
          animation="200"
          @end="onColumnDragEnd"
        >
          <template #item="{ element: column, index }">
            <Column
              :column="column"
              :cards="boardStore.columnViews[index]?.cards || []"
              :status="boardStore.columnViews[index]?.status || 'loading'"
              :error="boardStore.columnViews[index]?.error || ''"
              :all-columns="boardStore.columns"
              @add-card="handleAddCard"
              @edit-card="openCardDetail"
              @delete-card="confirmDeleteCard"
              @move-card="handleMoveCard"
              @rename-column="handleRenameColumn"
              @delete-column="confirmDeleteColumn"
              @retry-cards="handleRetryCards"
            />
          </template>
        </draggable>
      </div>
    </StateView>

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
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, ArrowLeft } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import { useBoardStore } from '../stores/board.js'
import { columnApi } from '../api/index.js'
import Column from '../components/Column.vue'
import AddCardForm from '../components/AddCardForm.vue'
import CardDetail from '../components/CardDetail.vue'
import StateView from '../components/StateView.vue'

const route = useRoute()
const boardStore = useBoardStore()

const showAddColumn = ref(false)
const newColumnName = ref('')
const showAddCard = ref(false)
const addingToColumnId = ref(null)
const showCardDetail = ref(false)
const selectedCard = ref(null)

onMounted(() => {
  reloadBoard()
})

function reloadBoard() {
  const boardId = parseInt(route.params.id)
  // Failures stay in the shared boardView; the StateView shows the retry button
  // instead of bouncing back to the board list.
  boardStore.loadBoard(boardId).catch(() => {})
}

function handleRetryCards(columnId) {
  boardStore.retryColumnCards(columnId).catch(() => {})
}

onUnmounted(() => {
  boardStore.clearBoard()
})

async function handleAddColumn() {
  if (!newColumnName.value.trim()) return
  try {
    await boardStore.addColumn(parseInt(route.params.id), newColumnName.value.trim())
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

async function handleMoveCard(cardId, targetColumnId, position) {
  try {
    await boardStore.moveCard(cardId, targetColumnId, position)
    ElMessage.success('Card moved')
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

async function onColumnDragEnd(evt) {
  // Update column positions after drag
  const currentColumns = boardStore.columns
  for (let i = 0; i < currentColumns.length; i++) {
    if (currentColumns[i].position !== i) {
      try {
        await columnApi.update(currentColumns[i].id, { position: i })
        currentColumns[i].position = i
      } catch (err) {
        // Refresh order from the server without discarding loaded cards
        await boardStore.refreshColumns(parseInt(route.params.id)).catch(() => {})
        break
      }
    }
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
</style>

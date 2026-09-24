import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { boardApi, columnApi, cardApi } from '../api/index.js'

function cardState() {
  return { status: 'idle', error: null }
}

export const useBoardStore = defineStore('board', () => {
  // ----- Raw state -----
  const boards = ref([])
  const currentBoard = ref(null)
  const columns = ref([])
  const cards = ref({}) // keyed by columnId -> [cards]

  // ----- Shared status: list page -----
  const boardListState = ref({ status: 'idle', error: null })

  // ----- Shared status: board workspace -----
  const boardState = ref({ status: 'idle', error: null })
  const cardStateMap = ref({}) // keyed by columnId -> { status, error }

  // ----- Derived views -----

  // Board list view, derived once so Home renders a consistent loading/error/empty/ready view.
  const listView = computed(() => {
    if (boardListState.value.status === 'loading' || boardListState.value.status === 'idle') {
      return { status: 'loading' }
    }
    if (boardListState.value.status === 'error') {
      return { status: 'error', error: boardListState.value.error }
    }
    if (boards.value.length === 0) {
      return { status: 'empty' }
    }
    return { status: 'ready', boards: boards.value }
  })

  // Board workspace view, shared by Board.vue.
  const boardView = computed(() => {
    const s = boardState.value.status
    if (s === 'loading' || s === 'idle') return { status: 'loading' }
    if (s === 'error') return { status: 'error', error: boardState.value.error }
    if (columns.value.length === 0) return { status: 'empty' }
    return { status: 'ready', columns: columns.value }
  })

  // Per-column view: cards plus their loading/empty/error state, so every column renders
  // identically whether it is loading, empty, or partially failed.
  const columnViews = computed(() =>
    columns.value.map(column => {
      const state = cardStateMap.value[column.id] || cardState()
      const columnCards = cards.value[column.id] || []
      let status = state.status
      if (status === 'idle') status = 'loading'
      if (status === 'ready' && columnCards.length === 0) status = 'empty'
      return { column, cards: columnCards, status, error: state.error }
    })
  )

  function getColumnView(columnId) {
    const column = columns.value.find(c => c.id === columnId)
    if (!column) return null
    return columnViews.value.find(v => v.column.id === columnId) || null
  }

  // ----- Board actions -----
  async function fetchBoards() {
    boardListState.value = { status: 'loading', error: null }
    try {
      const res = await boardApi.list()
      boards.value = res.data
      boardListState.value = { status: 'ready', error: null }
    } catch (err) {
      boardListState.value = {
        status: 'error',
        error: err.response?.data?.error || 'Failed to load boards'
      }
      throw err
    }
  }

  async function createBoard(name, description) {
    const res = await boardApi.create(name, description)
    boards.value.unshift(res.data)
    boardListState.value = { status: 'ready', error: null }
    return res.data
  }

  async function deleteBoard(id) {
    await boardApi.delete(id)
    boards.value = boards.value.filter(b => b.id !== id)
  }

  // ----- Column / workspace loading -----

  // Load the whole board workspace (metadata, columns and cards).
  // Board/column failures mark the board as failed; individual card failures are tracked
  // per column via allSettled so one failed column does not hide the rest of the board.
  async function loadBoard(boardId) {
    boardState.value = { status: 'loading', error: null }
    currentBoard.value = null
    columns.value = []
    cards.value = {}
    cardStateMap.value = {}

    try {
      const [boardResult, colsResult] = await Promise.allSettled([
        resolveBoardMeta(boardId),
        columnApi.list(boardId)
      ])

      if (boardResult.status === 'rejected' && colsResult.status === 'rejected') {
        throw boardResult.reason
      }
      if (colsResult.status === 'rejected') {
        throw colsResult.reason
      }

      if (boardResult.status === 'fulfilled') {
        currentBoard.value = boardResult.value
      } else {
        // Columns loaded but board metadata did not; keep the workspace usable.
        currentBoard.value = { id: boardId, name: `Board #${boardId}` }
      }

      const cols = colsResult.value.data
      columns.value = cols
      cards.value = {}
      cardStateMap.value = {}
      for (const col of cols) {
        cards.value[col.id] = []
        cardStateMap.value[col.id] = { status: 'loading', error: null }
      }
      boardState.value = { status: 'ready', error: null }

      await loadCardsForColumns(cols)
      return currentBoard.value
    } catch (err) {
      boardState.value = {
        status: 'error',
        error: err.response?.data?.error || 'Failed to load board'
      }
      throw err
    }
  }

  async function resolveBoardMeta(boardId) {
    const found = boards.value.find(b => b.id === boardId)
    if (found) return found
    const res = await boardApi.list()
    boards.value = res.data
    return (
      res.data.find(b => b.id === boardId) || { id: boardId, name: `Board #${boardId}` }
    )
  }

  async function fetchColumns(boardId) {
    columns.value = []
    cards.value = {}
    cardStateMap.value = {}
    const res = await columnApi.list(boardId)
    columns.value = res.data
    for (const col of res.data) {
      cards.value[col.id] = []
      cardStateMap.value[col.id] = { status: 'loading', error: null }
    }
    return res.data
  }

  async function addColumn(boardId, name) {
    const res = await columnApi.create(boardId, name)
    columns.value.push(res.data)
    cards.value[res.data.id] = []
    cardStateMap.value[res.data.id] = { status: 'ready', error: null }
    if (boardState.value.status === 'error') {
      boardState.value = { status: 'ready', error: null }
    }
    return res.data
  }

  async function renameColumn(colId, name) {
    const res = await columnApi.update(colId, { name })
    const idx = columns.value.findIndex(c => c.id === colId)
    if (idx !== -1) columns.value[idx] = res.data
    return res.data
  }

  async function deleteColumn(colId) {
    await columnApi.delete(colId)
    columns.value = columns.value.filter(c => c.id !== colId)
    delete cards.value[colId]
    delete cardStateMap.value[colId]
  }

  // Re-fetch column order without discarding already-loaded cards and their status.
  async function refreshColumns(boardId) {
    const res = await columnApi.list(boardId)
    const nextColumns = res.data
    const nextCards = {}
    const nextCardStates = {}
    for (const col of nextColumns) {
      nextCards[col.id] = cards.value[col.id] || []
      nextCardStates[col.id] = cardStateMap.value[col.id] || cardState()
    }
    columns.value = nextColumns
    cards.value = nextCards
    cardStateMap.value = nextCardStates
  }

  async function reorderColumn(colId, newPosition) {
    const res = await columnApi.update(colId, { position: newPosition })
    if (currentBoard.value) {
      await refreshColumns(currentBoard.value.id)
    }
    return res.data
  }

  // ----- Card actions -----

  // Fetch cards for several columns in parallel; each column keeps its own
  // ready/error state so partial failures render inline instead of failing the board.
  async function loadCardsForColumns(cols) {
    const results = await Promise.allSettled(cols.map(col => cardApi.list(col.id)))
    results.forEach((result, i) => {
      const colId = cols[i].id
      if (result.status === 'fulfilled') {
        cards.value[colId] = result.value.data
        cardStateMap.value[colId] = { status: 'ready', error: null }
      } else {
        cards.value[colId] = []
        cardStateMap.value[colId] = {
          status: 'error',
          error:
            result.reason?.response?.data?.error ||
            'Failed to load cards in this column'
        }
      }
    })
  }

  async function fetchCards(columnId) {
    cardStateMap.value[columnId] = { status: 'loading', error: null }
    try {
      const res = await cardApi.list(columnId)
      cards.value[columnId] = res.data
      cardStateMap.value[columnId] = { status: 'ready', error: null }
      return res.data
    } catch (err) {
      cards.value[columnId] = []
      cardStateMap.value[columnId] = {
        status: 'error',
        error: err.response?.data?.error || 'Failed to load cards in this column'
      }
      throw err
    }
  }

  // Retry a single column's cards after a partial failure.
  function retryColumnCards(columnId) {
    return fetchCards(columnId)
  }

  async function fetchAllCards(boardId) {
    const cols = columns.value.length
      ? columns.value
      : (await columnApi.list(boardId)).data
    if (!columns.value.length) {
      columns.value = cols
      cards.value = {}
      cardStateMap.value = {}
    }
    await loadCardsForColumns(cols)
  }

  async function addCard(columnId, data) {
    const res = await cardApi.create(columnId, data)
    if (!cards.value[columnId]) cards.value[columnId] = []
    cards.value[columnId].push(res.data)
    cardStateMap.value[columnId] = { status: 'ready', error: null }
    return res.data
  }

  async function updateCard(cardId, data) {
    const res = await cardApi.update(cardId, data)
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        cards.value[colId][idx] = res.data
        break
      }
    }
    return res.data
  }

  async function deleteCard(cardId) {
    await cardApi.delete(cardId)
    for (const colId in cards.value) {
      cards.value[colId] = cards.value[colId].filter(c => c.id !== cardId)
    }
  }

  async function moveCard(cardId, targetColumnId, position) {
    const res = await cardApi.move(cardId, targetColumnId, position)
    let movedCard = null
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        movedCard = cards.value[colId].splice(idx, 1)[0]
        break
      }
    }
    if (movedCard) {
      movedCard.column_id = targetColumnId
      movedCard.position = position
      if (!cards.value[targetColumnId]) cards.value[targetColumnId] = []
      cards.value[targetColumnId].splice(position, 0, movedCard)
      cardStateMap.value[targetColumnId] = { status: 'ready', error: null }
    }
    return res.data
  }

  function clearBoard() {
    currentBoard.value = null
    columns.value = []
    cards.value = {}
    boardState.value = { status: 'idle', error: null }
    cardStateMap.value = {}
  }

  return {
    // raw state
    boards, currentBoard, columns, cards,
    boardListState, boardState, cardStateMap,
    // derived views
    listView, boardView, columnViews, getColumnView,
    // board actions
    fetchBoards, createBoard, deleteBoard,
    // workspace / column actions
    loadBoard, fetchColumns, addColumn, renameColumn, deleteColumn,
    refreshColumns, reorderColumn,
    // card actions
    fetchCards, fetchAllCards, loadCardsForColumns, retryColumnCards,
    addCard, updateCard, deleteCard, moveCard,
    clearBoard
  }
})

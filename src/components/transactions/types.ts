export interface CategoryOption {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string;
}

export interface BatchOption {
  id: string;
  fileName: string;
  createdAt: string;
  transactionCount: number;
}

export interface TransactionRow {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  description: string;
  counterparty: string | null;
  date: string;
  importBatchId: string | null;
}

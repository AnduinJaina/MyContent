export interface Content {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentInput {
  title: string;
  body: string;
}

export type JobPhotoDTO = {
  id: string;
  jobId: string;
  employeeId: string;
  employeeName: string;
  url: string;
  caption: string | null;
  createdAt: Date;
  canDelete: boolean;
};

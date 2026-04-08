"use client";

import { useState, createContext, useContext } from "react";
import Button from "@/components/ui/Button";
import { Plus } from "lucide-react";
import { EmployeeModal } from "./EmployeeModal";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
}

interface EmployeeModalContextType {
  openCreateModal: () => void;
  openEditModal: (employee: Employee) => void;
}

const EmployeeModalContext = createContext<
  EmployeeModalContextType | undefined
>(undefined);

export const useEmployeeModal = () => {
  const context = useContext(EmployeeModalContext);
  if (!context) {
    throw new Error(
      "useEmployeeModal must be used within EmployeeModalProvider"
    );
  }
  return context;
};

export function EmployeeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null
  );
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");

  const openCreateModal = () => {
    setSelectedEmployee(null);
    setModalMode("create");
    setModalOpen(true);
  };

  const openEditModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setModalMode("edit");
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedEmployee(null);
  };

  return (
    <EmployeeModalContext.Provider value={{ openCreateModal, openEditModal }}>
      {children}
      <EmployeeModal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        employee={selectedEmployee}
        mode={modalMode}
      />
    </EmployeeModalContext.Provider>
  );
}

export function CreateEmployeeButton() {
  const { openCreateModal } = useEmployeeModal();

  return (
    <Button
      variant="primary"
      size="md"
      submit={false}
      onClick={openCreateModal}>
      <Plus className="w-4 h-4 mr-2" />
      Create Employee
    </Button>
  );
}


"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  X,
  User,
  Loader,
  Trash2,
  Mail,
  Phone,
  Lock,
  Shield,
  AlertTriangle,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import CustomDropdown from "@/components/ui/custom-dropdown";
import createEmployee from "../actions/createEmployee";
import { updateEmployee } from "../actions/updateEmployee";
import { deleteEmployee } from "../actions/deleteEmployee";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
}

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee?: Employee | null;
  mode: "create" | "edit";
}

const createFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["OWNER", "ADMIN", "EMPLOYEE"]),
});

const editFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  role: z.enum(["OWNER", "ADMIN", "EMPLOYEE"]),
});

type CreateFormValues = z.infer<typeof createFormSchema>;
type EditFormValues = z.infer<typeof editFormSchema>;

const roleOptions = [
  {
    value: "EMPLOYEE",
    label: "Employee",
    description: "Can log jobs and request inventory",
  },
  { value: "ADMIN", label: "Admin", description: "Can manage everything" },
  {
    value: "OWNER",
    label: "Owner",
    description: "Full access to all features",
  },
];

export function EmployeeModal({
  isOpen,
  onClose,
  employee,
  mode,
}: EmployeeModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedRole, setSelectedRole] = useState<
    "OWNER" | "ADMIN" | "EMPLOYEE"
  >(employee?.role || "EMPLOYEE");

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      role: "EMPLOYEE",
    },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    mode: "onChange",
    defaultValues: {
      name: employee?.name || "",
      email: employee?.email || "",
      phone: employee?.phone || "",
      role: employee?.role || "EMPLOYEE",
    },
  });

  const form = mode === "create" ? createForm : editForm;
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
  } = form;

  // Reset form when modal opens or employee changes
  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && employee) {
        editForm.reset({
          name: employee.name,
          email: employee.email,
          phone: employee.phone || "",
          role: employee.role,
        });
        setSelectedRole(employee.role);
      } else {
        createForm.reset({
          name: "",
          email: "",
          phone: "",
          password: "",
          role: "EMPLOYEE",
        });
        setSelectedRole("EMPLOYEE");
      }
      setShowDeleteConfirm(false);
      setGlobalError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, employee, mode]);

  // Update form when role changes
  useEffect(() => {
    setValue("role" as any, selectedRole);
  }, [selectedRole, setValue]);

  const disableForm = submitting || isDeleting;

  const onSubmit = async (values: CreateFormValues | EditFormValues) => {
    setSubmitting(true);
    setGlobalError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("email", values.email);
      formData.append("phone", values.phone || "");
      formData.append("role", selectedRole);

      if (mode === "create" && "password" in values) {
        formData.append("password", values.password);
      }

      let result;
      if (mode === "create") {
        result = await createEmployee({ message: "", error: "" }, formData);
      } else {
        result = await updateEmployee(
          employee!.id,
          { message: "", error: "" },
          formData
        );
      }

      if (result.error) {
        throw new Error(result.error);
      }

      setSuccessMessage(
        result.message ||
          (mode === "create"
            ? "Employee created successfully"
            : "Employee updated successfully")
      );

      setTimeout(() => {
        reset();
        handleClose();
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("Submit error:", error);
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!employee) return;

    setIsDeleting(true);
    setGlobalError(null);

    try {
      const result = await deleteEmployee(employee.id);

      if (!result.success) {
        throw new Error(result.error || "Failed to delete employee");
      }

      handleClose();
      window.location.reload();
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "Failed to delete employee"
      );
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleClose = () => {
    if (!submitting && !isDeleting) {
      reset();
      setGlobalError(null);
      setSuccessMessage(null);
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={handleClose}
      />

      {/* Modal Container */}
      <div className="relative z-[1001] w-full max-w-2xl max-h-[95vh] gap-0 bg-white rounded-3xl overflow-hidden">
        {/* Form Section */}
        <section className="w-full bg-[#ffffff]/5 flex items-start justify-center overflow-y-auto">
          <div className="w-full max-w-[80rem] mx-auto px-6 md:px-8 py-6 md:py-8">
            {/* Header */}
            <div className="w-full flex items-start justify-between gap-1 mb-8">
              <div>
                <h1 className="text-3xl font-[350] tracking-tight text-[#005F6A] max-w-[40rem]">
                  {mode === "create" ? "Add New Employee" : "Edit Employee"}
                </h1>
                <p className="text-sm text-[#005F6A]/80">
                  {mode === "create"
                    ? "Add a new team member to your organization"
                    : "Update employee details"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={disableForm}
                className="!p-2">
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="rounded-2xl p-4 flex items-start gap-3 bg-green-50 border border-green-200 mb-6">
                <div className="flex flex-col gap-1 flex-1">
                  <p className="text-sm text-green-700 font-[400]">
                    {successMessage}
                  </p>
                </div>
              </div>
            )}

            {/* Delete Confirmation */}
            {mode === "edit" && showDeleteConfirm && (
              <div className="rounded-2xl p-4 flex items-start gap-3 bg-red-50 border border-red-200 mb-6">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col gap-2 flex-1">
                  <p className="text-sm text-red-700 font-[400]">
                    Are you sure you want to delete this employee?
                  </p>
                  <p className="text-xs text-red-600/70">
                    This action cannot be undone. All employee data will be
                    permanently removed.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="default"
                      size="sm"
                      border={false}
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="px-4 py-2">
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      border={false}
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="px-4 py-2">
                      {isDeleting ? (
                        <>
                          <Loader className="w-4 h-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Confirm Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <form
              onSubmit={handleSubmit(onSubmit as any)}
              className="space-y-6">
              {/* Full Name */}
              <div>
                <label className="input-label">
                  Full Name <span className="text-red-500 ml-1">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                  <Input
                    variant="form"
                    type="text"
                    size="md"
                    {...register("name")}
                    disabled={disableForm}
                    error={!!errors.name}
                    className="w-full pl-11 px-4 py-3"
                    placeholder="John Doe"
                    border={false}
                  />
                </div>
                {errors.name && (
                  <p className="my-1 text-xs text-red-600">
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="input-label">
                  Email Address <span className="text-red-500 ml-1">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                  <Input
                    variant="form"
                    type="email"
                    size="md"
                    {...register("email")}
                    disabled={disableForm}
                    error={!!errors.email}
                    className="w-full pl-11 px-4 py-3"
                    placeholder="john@example.com"
                    border={false}
                  />
                </div>
                {errors.email && (
                  <p className="my-1 text-xs text-red-600">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Phone */}
              <div>
                <label className="input-label">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                  <Input
                    variant="form"
                    type="tel"
                    size="md"
                    {...register("phone")}
                    disabled={disableForm}
                    className="w-full pl-11 px-4 py-3"
                    placeholder="(555) 123-4567"
                    border={false}
                  />
                </div>
                <p className="text-xs text-[#005F6A]/60 mt-1">
                  Optional contact number
                </p>
              </div>

              {/* Password (Create mode only) */}
              {mode === "create" && (
                <div>
                  <label className="input-label">
                    Password <span className="text-red-500 ml-1">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                    <Input
                      variant="form"
                      type="password"
                      size="md"
                      {...register("password" as any)}
                      disabled={disableForm}
                      error={!!(errors as any).password}
                      className="w-full pl-11 px-4 py-3"
                      placeholder="Minimum 8 characters"
                      border={false}
                    />
                  </div>
                  {(errors as any).password && (
                    <p className="my-1 text-xs text-red-600">
                      {(errors as any).password.message}
                    </p>
                  )}
                  <p className="text-xs text-[#005F6A]/60 mt-1">
                    Initial password - they can change it later
                  </p>
                </div>
              )}

              {/* Role */}
              <div>
                <label className="input-label">
                  Role <span className="text-red-500 ml-1">*</span>
                </label>
                <CustomDropdown
                  trigger={
                    <Button
                      variant="default"
                      size="md"
                      border={false}
                      type="button"
                      disabled={disableForm}
                      className="w-full h-[42px] px-4 py-3 flex items-center justify-between bg-[#005F6A]/5">
                      <div className="flex items-center gap-3">
                        <Shield className="w-4 h-4 text-[#005F6A]/50" />
                        <span className="text-sm font-[350] text-[#005F6A]">
                          {
                            roleOptions.find((r) => r.value === selectedRole)
                              ?.label
                          }
                        </span>
                      </div>
                      <svg
                        className="w-4 h-4 text-[#005F6A]/50"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </Button>
                  }
                  options={roleOptions.map((opt) => ({
                    label: opt.label,
                    onClick: () => setSelectedRole(opt.value as any),
                  }))}
                  maxHeight="12rem"
                />
                <div className="mt-3 p-3 bg-[#005F6A]/5 rounded-xl">
                  <p className="text-xs text-[#005F6A]/80">
                    <strong className="text-[#005F6A]">
                      {roleOptions.find((r) => r.value === selectedRole)?.label}
                      :
                    </strong>{" "}
                    {
                      roleOptions.find((r) => r.value === selectedRole)
                        ?.description
                    }
                  </p>
                </div>
              </div>

              {/* Global Error */}
              {globalError && (
                <div className="bg-red-50 rounded-2xl p-3">
                  <p className="text-xs text-red-600">{globalError}</p>
                </div>
              )}

              {/* Submit Button */}
              <div className="w-full flex flex-col md:flex-row justify-between items-center pt-4 gap-4">
                {/* Delete button on the left (only in edit mode) */}
                {mode === "edit" && !showDeleteConfirm && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={disableForm}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 px-4 py-3 w-full md:w-auto">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Employee
                  </Button>
                )}

                {mode === "create" && <div />}

                <div className="flex gap-3 w-full md:w-auto">
                  <Button
                    type="button"
                    variant="default"
                    size="md"
                    border={false}
                    onClick={handleClose}
                    disabled={disableForm}
                    className="px-6 py-3 flex-1 md:flex-none">
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    type="submit"
                    disabled={disableForm}
                    className="px-6 py-3 flex-1 md:flex-none">
                    {submitting ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        {mode === "create" ? "Creating..." : "Updating..."}
                      </>
                    ) : (
                      <>
                        <User className="w-4 h-4 mr-2" />
                        {mode === "create"
                          ? "Create Employee"
                          : "Update Employee"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import CleanerSelector from "./CleanerSelector";
import JobTypeSelector from "./JobTypeSelector";
import SubmitButton from "./SubmitButton";
import DeleteButton from "./DeleteButton";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";

export default async function JobFormPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit: jobId } = await searchParams;
  const isEditing = !!jobId;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Get existing job if editing
  let existingJob = null;
  if (isEditing) {
    existingJob = await db.job.findUnique({
      where: { id: jobId },
      include: {
        cleaners: true,
      },
    });

    if (!existingJob || existingJob.employeeId !== session.user.id) {
      redirect("/jobs");
    }
  }

  // Get all users to populate the cleaners dropdown
  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  async function saveJob(formData: FormData) {
    "use server";

    const session = await auth.api.getSession({
      headers: await headers(),
    });

    // Get selected cleaner IDs from form
    const cleanerIds = formData.getAll("cleaners") as string[];

    // Parse all form fields according to schema
    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endDate = formData.get("endDate") as string;
    const endTime = formData.get("endTime") as string;

    const jobData: any = {
      employeeId: session!.user.id,
      clientName: formData.get("clientName") as string,
      description: (formData.get("description") as string) || null,
      jobType: (formData.get("jobType") as string) || null,
      location: (formData.get("location") as string) || null,
      jobDate: startDate ? new Date(startDate) : null,
      startTime:
        startDate && startTime
          ? new Date(`${startDate}T${startTime}`)
          : new Date(),
      endTime: endDate && endTime ? new Date(`${endDate}T${endTime}`) : null,
      price: formData.get("price")
        ? parseFloat(formData.get("price") as string)
        : null,
      employeePay: formData.get("employeePay")
        ? parseFloat(formData.get("employeePay") as string)
        : null,
      totalTip: formData.get("totalTip")
        ? parseFloat(formData.get("totalTip") as string)
        : null,
      parking: formData.get("parking")
        ? parseFloat(formData.get("parking") as string)
        : null,
      paymentReceived: formData.get("paymentReceived") === "on",
      invoiceSent: formData.get("invoiceSent") === "on",
      notes: (formData.get("notes") as string) || null,
    };

    const editingJobId = formData.get("jobId") as string | null;

    if (editingJobId) {
      // UPDATE existing job
      await db.job.update({
        where: { id: editingJobId },
        data: {
          ...jobData,
          cleaners:
            cleanerIds.length > 0
              ? {
                  set: cleanerIds.map((id) => ({ id })),
                }
              : undefined,
        },
      });

      revalidatePath("/jobs");
      redirect(`/jobs/${editingJobId}`);
    } else {
      // CREATE new job
      // Only add cleaners if there are any selected
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }

      await db.job.create({
        data: jobData,
      });

      revalidatePath("/jobs");
      redirect("/jobs");
    }
  }

  async function deleteJob(formData: FormData) {
    "use server";

    const jobId = formData.get("jobId") as string;

    await db.job.delete({
      where: { id: jobId },
    });

    revalidatePath("/jobs");
    redirect("/jobs");
  }

  // Get selected cleaner IDs for editing
  const selectedCleanerIds = existingJob?.cleaners.map((c) => c.id) || [];

  return (
    <div className="max-w-[80rem] mx-auto text-black">
      <Card variant="ghost" className="mb-6">
        <h1 className="text-3xl font-[400] text-neutral-950">
          {isEditing ? "Edit Cleaning Job" : "Create New Cleaning Job"}
        </h1>
        <p className="text-neutral-950/80 mt-1">
          {isEditing
            ? "Update the details for your cleaning job"
            : "Fill in the details for your cleaning job"}
        </p>
      </Card>

      <form action={saveJob} className="space-y-6">
        {/* Hidden field for job ID when editing */}
        {isEditing && existingJob && (
          <input type="hidden" name="jobId" value={existingJob.id} />
        )}
        {/* Basic Information */}
        <Card variant="ghost">
          <Card variant="cleano_dark" className="mb-4">
            <h2 className="text-xl font-[400] text-neutral-950 w-full">
              Basic Information
            </h2>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="clientName"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Client Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                id="clientName"
                name="clientName"
                required
                defaultValue={existingJob?.clientName || ""}
                placeholder="e.g., Alexis Juarez"
              />
            </div>

            <div>
              <label
                htmlFor="jobType"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Job Type
              </label>
              <JobTypeSelector initialValue={existingJob?.jobType} />
            </div>

            <div>
              <label
                htmlFor="location"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Location
              </label>
              <Input
                type="text"
                id="location"
                name="location"
                defaultValue={existingJob?.location || ""}
                placeholder="Address or area"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="description"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Description
              </label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                defaultValue={existingJob?.description || ""}
                placeholder="Brief description of the job..."
              />
            </div>
          </div>
        </Card>

        {/* Date & Time */}
        <Card variant="ghost">
          <Card variant="cleano_dark" className="mb-4">
            <h2 className="text-xl font-[400] text-neutral-950 w-full">
              Date & Time
            </h2>
          </Card>
          <div className="space-y-4">
            {/* Start Date & Time */}
            <div>
              <h3 className="text-sm font-[500] text-neutral-950/90 mb-2">
                Start
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="startDate"
                    className="block text-sm font-[400] text-neutral-950/80 mb-1">
                    Start Date
                  </label>
                  <Input
                    type="date"
                    id="startDate"
                    name="startDate"
                    defaultValue={
                      existingJob?.startTime
                        ? new Date(existingJob.startTime)
                            .toISOString()
                            .split("T")[0]
                        : ""
                    }
                  />
                </div>

                <div>
                  <label
                    htmlFor="startTime"
                    className="block text-sm font-[400] text-neutral-950/80 mb-1">
                    Start Time
                  </label>
                  <Input
                    type="time"
                    id="startTime"
                    name="startTime"
                    defaultValue={
                      existingJob?.startTime
                        ? new Date(existingJob.startTime)
                            .toISOString()
                            .split("T")[1]
                            .slice(0, 5)
                        : ""
                    }
                  />
                </div>
              </div>
            </div>

            {/* End Date & Time */}
            <div>
              <h3 className="text-sm font-[500] text-neutral-950/90 mb-2">
                End
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="endDate"
                    className="block text-sm font-[400] text-neutral-950/80 mb-1">
                    End Date
                  </label>
                  <Input
                    type="date"
                    id="endDate"
                    name="endDate"
                    defaultValue={
                      existingJob?.endTime
                        ? new Date(existingJob.endTime)
                            .toISOString()
                            .split("T")[0]
                        : ""
                    }
                  />
                </div>

                <div>
                  <label
                    htmlFor="endTime"
                    className="block text-sm font-[400] text-neutral-950/80 mb-1">
                    End Time
                  </label>
                  <Input
                    type="time"
                    id="endTime"
                    name="endTime"
                    defaultValue={
                      existingJob?.endTime
                        ? new Date(existingJob.endTime)
                            .toISOString()
                            .split("T")[1]
                            .slice(0, 5)
                        : ""
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Team & Hours */}
        <Card variant="ghost">
          <Card variant="cleano_dark" className="mb-4">
            <h2 className="text-xl font-[400] text-neutral-950 w-full">Team</h2>
          </Card>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <CleanerSelector
                users={users}
                initialSelectedIds={selectedCleanerIds}
              />
            </div>
          </div>
        </Card>

        {/* Pricing & Payment */}
        <Card variant="ghost">
          <Card variant="cleano_dark" className="mb-4">
            <h2 className="text-xl font-[400] text-neutral-950 w-full">
              Pricing & Payment
            </h2>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="price"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Price
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <Input
                  type="number"
                  step="0.01"
                  id="price"
                  name="price"
                  defaultValue={existingJob?.price || ""}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="employeePay"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Employee Pay
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <Input
                  type="number"
                  step="0.01"
                  id="employeePay"
                  name="employeePay"
                  defaultValue={existingJob?.employeePay || ""}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="totalTip"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Total Tip
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <Input
                  type="number"
                  step="0.01"
                  id="totalTip"
                  name="totalTip"
                  defaultValue={existingJob?.totalTip || ""}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="parking"
                className="block text-sm font-[400] text-neutral-950/80 mb-1">
                Parking
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <Input
                  type="number"
                  step="0.01"
                  id="parking"
                  name="parking"
                  defaultValue={existingJob?.parking || ""}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Notes */}
        <Card variant="ghost">
          <Card variant="cleano_dark" className="mb-4">
            <h2 className="text-xl font-[400] text-neutral-950 w-full">
              Additional Details
            </h2>
          </Card>
          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-[400] text-neutral-950/80 mb-1">
              Notes
            </label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={existingJob?.notes || ""}
              placeholder="Any additional notes or special requirements..."
            />
          </div>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-between">
          {isEditing && existingJob && (
            <form action={deleteJob}>
              <input type="hidden" name="jobId" value={existingJob.id} />
              <DeleteButton />
            </form>
          )}
          <div className={`flex space-x-4 ${!isEditing ? "ml-auto" : ""}`}>
            <a href={isEditing ? `/jobs/${existingJob?.id}` : "/jobs"}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </a>
            <SubmitButton isEditing={isEditing} />
          </div>
        </div>
      </form>
    </div>
  );
}

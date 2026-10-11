import { Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import { ActorCtx, ContactsService } from "./contacts.service";

@Controller("contacts")
@UseGuards(AuthGuard, OrgGuard)
export class ContactsController {
  constructor(@Inject(ContactsService) private readonly contacts: ContactsService) {}

  private ctx(req: any): ActorCtx {
    return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
  }

  @Get()
  list(@Req() req: any, @Query() q: any) {
    return this.contacts.list(this.ctx(req), q);
  }

  @Post()
  create(@Req() req: any, @Body() dto: any) {
    return this.contacts.create(this.ctx(req), dto);
  }

  @Get("export")
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", 'attachment; filename="contacts.csv"')
  export(@Req() req: any, @Query() q: any) {
    return this.contacts.exportCsv(this.ctx(req), q);
  }

  @Post("import")
  import(@Req() req: any, @Body() dto: any) {
    return this.contacts.importRows(this.ctx(req), dto?.rows, dto?.dryRun === true);
  }

  @Post("merge")
  merge(@Req() req: any, @Body() dto: any) {
    return this.contacts.merge(this.ctx(req), dto?.survivingId, dto?.mergedId);
  }

  @Get(":id")
  get(@Req() req: any, @Param("id") id: string) {
    return this.contacts.get(this.ctx(req), id);
  }

  @Patch(":id")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.contacts.update(this.ctx(req), id, dto);
  }

  @Get(":id/activities")
  activities(@Req() req: any, @Param("id") id: string) {
    return this.contacts.activities(this.ctx(req), id);
  }

  @Post(":id/notes")
  addNote(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.contacts.addNote(this.ctx(req), id, dto?.body);
  }

  @Post(":id/tags")
  addTag(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.contacts.addTag(this.ctx(req), id, dto?.name);
  }

  @Delete(":id/tags/:tagId")
  removeTag(@Req() req: any, @Param("id") id: string, @Param("tagId") tagId: string) {
    return this.contacts.removeTag(this.ctx(req), id, tagId);
  }
}

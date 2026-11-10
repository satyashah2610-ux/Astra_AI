"""One company can never see or change another company's agreements or files."""
import pytest

from app.main import create_app
from tests.staff import StaffClient
from tests.test_agreements import mark, pdf_bytes, save, upload
from tests.test_files import create_file, file_body, prepared_agreement, token_from


@pytest.fixture
def companies(tmp_path):
    """Company A with an agreement and a sent file; company B, signed in separately, on the same server."""
    app = create_app(tmp_path)
    with StaffClient(app, company="Alpha Ltd", email="a@alpha.example") as alpha, \
         StaffClient(app, company="Beta Ltd", email="b@beta.example") as beta:
        agreement = prepared_agreement(alpha)
        draft = create_file(alpha, agreement["id"]).json()
        sent = create_file(alpha, agreement["id"], title="Sent job").json()
        alpha.post(f"/api/files/{sent['id']}/send")
        yield alpha, beta, agreement, draft, sent


def test_lists_only_show_your_own_company(companies):
    alpha, beta, agreement, draft, sent = companies
    assert beta.get("/api/agreements").json() == []
    assert beta.get("/api/files").json() == []
    assert len(alpha.get("/api/agreements").json()) == 1
    assert len(alpha.get("/api/files").json()) == 2


@pytest.mark.parametrize("method,path", [("GET", "/api/agreements/{a}"), ("GET", "/api/agreements/{a}/pdf"), ("DELETE", "/api/agreements/{a}")])
def test_another_companys_agreement_is_not_found(companies, method, path):
    alpha, beta, agreement, *_ = companies
    assert beta.request(method, path.format(a=agreement["id"])).status_code == 404
    assert alpha.get(f"/api/agreements/{agreement['id']}").status_code == 200


def test_another_companys_agreement_cannot_be_edited(companies):
    alpha, beta, agreement, *_ = companies
    assert save(beta, agreement["id"], [mark(x=.5)], version=1).status_code == 404
    assert alpha.get(f"/api/agreements/{agreement['id']}").json()["marks"] == [mark()]


def test_another_companys_agreement_cannot_be_used_for_a_file(companies):
    alpha, beta, agreement, *_ = companies
    assert create_file(beta, agreement["id"]).status_code == 422
    beta_agreement = prepared_agreement(beta)
    draft = create_file(beta, beta_agreement["id"]).json()
    assert beta.patch(f"/api/files/{draft['id']}", json={"version": 0, "agreement_id": agreement["id"]}).status_code == 422


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/files/{f}", None), ("PATCH", "/api/files/{f}", {"version": 0, "title": "Taken over"}), ("DELETE", "/api/files/{f}", None),
    ("POST", "/api/files/{f}/send", None), ("GET", "/api/files/{f}/events", None),
])
def test_another_companys_draft_is_not_found(companies, method, path, body):
    alpha, beta, agreement, draft, sent = companies
    assert beta.request(method, path.format(f=draft["id"]), json=body).status_code == 404
    assert alpha.get(f"/api/files/{draft['id']}").json()["status"] == "draft"


@pytest.mark.parametrize("path", ["/api/files/{f}/link", "/api/files/{f}/pdf", "/api/files/{f}/signed.pdf"])
def test_another_companys_sent_file_is_not_found(companies, path):
    alpha, beta, agreement, draft, sent = companies
    method = "POST" if path.endswith("/link") else "GET"
    assert beta.request(method, path.format(f=sent["id"])).status_code == 404


def test_agreement_names_are_unique_per_company_only(companies):
    alpha, beta, *_ = companies
    assert upload(beta, name="Agreement.pdf").json()["name"] == "Agreement"
    assert upload(alpha, name="Agreement.pdf").json()["name"] == "Agreement (1)"


def test_deleting_an_agreement_only_counts_your_own_drafts(companies):
    alpha, beta, agreement, *_ = companies
    other = upload(beta, pdf_bytes(), name="Theirs.pdf").json()
    assert beta.delete(f"/api/agreements/{other['id']}").status_code == 204
